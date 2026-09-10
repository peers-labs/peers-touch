use super::{
    decrypt_attachment_chunk, encrypt_attachment_chunk, validate_encrypted_object_descriptor,
    AttachmentCryptoMaterial, EncryptedAttachmentChunk, ATTACHMENT_TAG_SIZE,
};
use crate::ports::AttachmentBlob;
use crate::proto::chat::{
    AttachmentTransferErrorCode, AttachmentTransferState, EncryptedObjectDescriptor,
    EncryptedObjectUploadSpec,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

pub const ATTACHMENT_TRANSFER_MEMORY_OVERHEAD: usize = 16 * 1024 * 1024;
const ATTACHMENT_MAX_ACTIVE_TRANSFERS: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentTransferFailure {
    pub code: AttachmentTransferErrorCode,
    pub retry_after_ms: Option<i64>,
    pub retryable: bool,
    pub detail: String,
}

impl AttachmentTransferFailure {
    pub fn retryable(
        code: AttachmentTransferErrorCode,
        retry_after_ms: Option<i64>,
        detail: String,
    ) -> Self {
        Self {
            code,
            retry_after_ms,
            retryable: true,
            detail,
        }
    }

    pub fn terminal(code: AttachmentTransferErrorCode, detail: String) -> Self {
        Self {
            code,
            retry_after_ms: None,
            retryable: false,
            detail,
        }
    }
}

impl std::fmt::Display for AttachmentTransferFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code.as_str_name(), self.detail)
    }
}

impl std::error::Error for AttachmentTransferFailure {}

impl From<String> for AttachmentTransferFailure {
    fn from(detail: String) -> Self {
        Self::retryable(AttachmentTransferErrorCode::RetryLater, None, detail)
    }
}

fn integrity_failure(detail: String) -> AttachmentTransferFailure {
    AttachmentTransferFailure::terminal(AttachmentTransferErrorCode::IntegrityFailed, detail)
}

fn store_failure(detail: String) -> AttachmentTransferFailure {
    if detail == "messaging attachment descriptor commitment changed" {
        return AttachmentTransferFailure::terminal(
            AttachmentTransferErrorCode::DescriptorMismatch,
            detail,
        );
    }
    detail.into()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AttachmentRetryPolicy {
    pub initial_delay_ms: i64,
    pub maximum_delay_ms: i64,
}

impl Default for AttachmentRetryPolicy {
    fn default() -> Self {
        Self {
            initial_delay_ms: 1_000,
            maximum_delay_ms: 300_000,
        }
    }
}

impl AttachmentRetryPolicy {
    fn validate(self) -> Result<Self, String> {
        if self.initial_delay_ms <= 0 || self.maximum_delay_ms < self.initial_delay_ms {
            return Err("messaging attachment retry policy is invalid".to_string());
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachmentTransferProgress {
    Complete,
    Deferred { next_attempt_at_unix_ms: i64 },
    RetryScheduled { next_attempt_at_unix_ms: i64 },
    Terminal { code: AttachmentTransferErrorCode },
}

pub struct AttachmentTransferControl {
    shutdown: AtomicBool,
    active: AtomicUsize,
    active_attachment_ids: Mutex<HashSet<String>>,
}

#[derive(Debug)]
enum AttachmentAdmissionError {
    AlreadyActive,
    Failure(AttachmentTransferFailure),
}

impl AttachmentTransferControl {
    pub fn new() -> Self {
        Self {
            shutdown: AtomicBool::new(false),
            active: AtomicUsize::new(0),
            active_attachment_ids: Mutex::new(HashSet::new()),
        }
    }

    pub fn request_shutdown(&self) {
        self.shutdown.store(true, Ordering::Release);
    }

    fn check_running(&self) -> Result<(), AttachmentTransferFailure> {
        if self.shutdown.load(Ordering::Acquire) {
            return Err(AttachmentTransferFailure::retryable(
                AttachmentTransferErrorCode::RetryLater,
                None,
                "messaging attachment transfer is shutting down".to_string(),
            ));
        }
        Ok(())
    }

    fn try_admit(
        &self,
        attachment_id: &str,
    ) -> Result<AttachmentTransferPermit<'_>, AttachmentAdmissionError> {
        self.check_running()
            .map_err(AttachmentAdmissionError::Failure)?;
        let mut active_attachment_ids = self.active_attachment_ids.lock().map_err(|_| {
            AttachmentAdmissionError::Failure(AttachmentTransferFailure::retryable(
                AttachmentTransferErrorCode::RetryLater,
                None,
                "messaging attachment transfer admission lock is poisoned".to_string(),
            ))
        })?;
        if active_attachment_ids.contains(attachment_id) {
            return Err(AttachmentAdmissionError::AlreadyActive);
        }
        let admitted = self
            .active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < ATTACHMENT_MAX_ACTIVE_TRANSFERS).then_some(active + 1)
            })
            .is_ok();
        if !admitted {
            return Err(AttachmentAdmissionError::Failure(
                AttachmentTransferFailure::retryable(
                    AttachmentTransferErrorCode::RetryLater,
                    None,
                    "messaging attachment transfer admission is full".to_string(),
                ),
            ));
        }
        active_attachment_ids.insert(attachment_id.to_string());
        Ok(AttachmentTransferPermit {
            control: self,
            attachment_id: attachment_id.to_string(),
        })
    }
}

impl Default for AttachmentTransferControl {
    fn default() -> Self {
        Self::new()
    }
}

struct AttachmentTransferPermit<'a> {
    control: &'a AttachmentTransferControl,
    attachment_id: String,
}

impl Drop for AttachmentTransferPermit<'_> {
    fn drop(&mut self) {
        if let Ok(mut active_attachment_ids) = self.control.active_attachment_ids.lock() {
            active_attachment_ids.remove(&self.attachment_id);
        }
        self.control.active.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Debug, Clone)]
pub struct PreparedAttachmentUpload {
    pub object: EncryptedObjectUploadSpec,
    pub descriptor_sha256: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentTransferRecord {
    pub attachment_id: String,
    pub conversation_id: String,
    pub message_id: String,
    pub authority_station_id: String,
    pub direction: i32,
    pub state: i32,
    pub upload_id: String,
    pub generation: u64,
    pub descriptor_sha256: Vec<u8>,
    pub completed_chunk_bitmap: Vec<u8>,
    pub source_local_ref: String,
    pub partial_local_ref: String,
    pub object_key: Vec<u8>,
    pub base_nonce: Vec<u8>,
    pub plaintext_size: u64,
    pub chunk_size: u32,
    pub attempt_count: u32,
    pub next_attempt_at_unix_ms: i64,
    pub last_error_code: i32,
    pub updated_at_unix_ms: i64,
}

pub fn validate_attachment_transfer_record(
    transfer: &AttachmentTransferRecord,
) -> Result<(), String> {
    if transfer.attachment_id.trim().is_empty()
        || transfer.conversation_id.trim().is_empty()
        || transfer.message_id.trim().is_empty()
        || transfer.authority_station_id.trim().is_empty()
        || transfer.direction <= 0
        || transfer.state <= 0
        || transfer.descriptor_sha256.len() != 32
        || transfer.completed_chunk_bitmap.is_empty()
        || (transfer.source_local_ref.trim().is_empty()
            && transfer.partial_local_ref.trim().is_empty())
        || transfer.object_key.len() != 32
        || transfer.base_nonce.len() != 12
        || transfer.base_nonce[8..] != [0, 0, 0, 0]
        || transfer.plaintext_size == 0
        || transfer.plaintext_size > super::ATTACHMENT_MAX_PLAINTEXT_SIZE
        || transfer.chunk_size == 0
        || transfer.chunk_size > super::ATTACHMENT_CHUNK_SIZE
        || transfer.next_attempt_at_unix_ms < 0
        || transfer.updated_at_unix_ms <= 0
    {
        return Err("messaging attachment transfer is incomplete".to_string());
    }
    Ok(())
}

pub trait AttachmentTransferRepository: Send + Sync {
    fn attachment_transfer(
        &self,
        attachment_id: &str,
    ) -> Result<Option<AttachmentTransferRecord>, String>;

    fn attachment_upload_media_type(&self, attachment_id: &str) -> Result<String, String>;

    fn update_attachment_transfer_prepared(
        &self,
        attachment_id: &str,
        descriptor_sha256: &[u8],
        partial_local_ref: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), String>;

    #[allow(clippy::too_many_arguments)]
    fn update_attachment_transfer_progress(
        &self,
        attachment_id: &str,
        state: i32,
        upload_id: &str,
        generation: u64,
        completed_chunk_bitmap: &[u8],
        attempt_count: u32,
        next_attempt_at_unix_ms: i64,
        last_error_code: i32,
        updated_at_unix_ms: i64,
    ) -> Result<(), String>;

    fn complete_attachment_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        updated_at_unix_ms: i64,
    ) -> Result<(), String>;

    fn complete_attachment_download(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        cache_path: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), String>;
}

pub trait AttachmentTransferTransport: Send + Sync {
    fn begin_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<(String, u64, Vec<u8>), AttachmentTransferFailure>;

    fn put_upload_chunk(
        &self,
        transfer: &AttachmentTransferRecord,
        chunk: &EncryptedAttachmentChunk,
    ) -> Result<(), AttachmentTransferFailure>;

    fn complete_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<EncryptedObjectDescriptor, AttachmentTransferFailure>;

    fn get_download_chunk(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        chunk_index: u32,
        start: u64,
        end: u64,
    ) -> Result<Vec<u8>, AttachmentTransferFailure>;

    fn cancel_upload(
        &self,
        transfer: &AttachmentTransferRecord,
    ) -> Result<(), AttachmentTransferFailure>;
}

pub struct AttachmentTransferWorker {
    store: Arc<dyn AttachmentTransferRepository>,
    transport: Arc<dyn AttachmentTransferTransport>,
    blobs: Arc<dyn AttachmentBlob>,
    control: Arc<AttachmentTransferControl>,
    retry_policy: AttachmentRetryPolicy,
}

impl AttachmentTransferWorker {
    pub fn new(
        store: Arc<dyn AttachmentTransferRepository>,
        transport: Arc<dyn AttachmentTransferTransport>,
        blobs: Arc<dyn AttachmentBlob>,
    ) -> Self {
        Self::with_control(
            store,
            transport,
            blobs,
            Arc::new(AttachmentTransferControl::new()),
            AttachmentRetryPolicy::default(),
        )
        .expect("default attachment transfer policy must be valid")
    }

    pub fn with_control(
        store: Arc<dyn AttachmentTransferRepository>,
        transport: Arc<dyn AttachmentTransferTransport>,
        blobs: Arc<dyn AttachmentBlob>,
        control: Arc<AttachmentTransferControl>,
        retry_policy: AttachmentRetryPolicy,
    ) -> Result<Self, String> {
        Ok(Self {
            store,
            transport,
            blobs,
            control,
            retry_policy: retry_policy.validate()?,
        })
    }

    pub fn memory_bound(chunk_size: u32) -> usize {
        2 * chunk_size as usize + ATTACHMENT_TRANSFER_MEMORY_OVERHEAD
    }

    pub fn run_upload_once(
        &self,
        attachment_id: &str,
        now_unix_ms: i64,
    ) -> Result<AttachmentTransferProgress, String> {
        if let Some(progress) = self.preflight(attachment_id, now_unix_ms)? {
            return Ok(progress);
        }
        let _permit = match self.control.try_admit(attachment_id) {
            Ok(permit) => permit,
            Err(AttachmentAdmissionError::AlreadyActive) => {
                return Ok(AttachmentTransferProgress::Deferred {
                    next_attempt_at_unix_ms: now_unix_ms,
                })
            }
            Err(AttachmentAdmissionError::Failure(failure)) => {
                return self.persist_failure(attachment_id, now_unix_ms, failure)
            }
        };
        match self.upload_once(attachment_id, now_unix_ms) {
            Ok(true) => Ok(AttachmentTransferProgress::Complete),
            Ok(false) => Err("messaging attachment upload made no progress".to_string()),
            Err(failure) => self.persist_failure(attachment_id, now_unix_ms, failure),
        }
    }

    pub fn run_download_once(
        &self,
        attachment_id: &str,
        descriptor: &EncryptedObjectDescriptor,
        expected_plaintext_sha256: &[u8; 32],
        cache_ref: &str,
        now_unix_ms: i64,
    ) -> Result<AttachmentTransferProgress, String> {
        if let Some(progress) = self.preflight(attachment_id, now_unix_ms)? {
            return Ok(progress);
        }
        let _permit = match self.control.try_admit(attachment_id) {
            Ok(permit) => permit,
            Err(AttachmentAdmissionError::AlreadyActive) => {
                return Ok(AttachmentTransferProgress::Deferred {
                    next_attempt_at_unix_ms: now_unix_ms,
                })
            }
            Err(AttachmentAdmissionError::Failure(failure)) => {
                return self.persist_failure(attachment_id, now_unix_ms, failure)
            }
        };
        match self.download_once(
            attachment_id,
            descriptor,
            expected_plaintext_sha256,
            cache_ref,
            now_unix_ms,
        ) {
            Ok(true) => Ok(AttachmentTransferProgress::Complete),
            Ok(false) => Err("messaging attachment download made no progress".to_string()),
            Err(failure) => self.persist_failure(attachment_id, now_unix_ms, failure),
        }
    }

    fn upload_once(
        &self,
        attachment_id: &str,
        now_unix_ms: i64,
    ) -> Result<bool, AttachmentTransferFailure> {
        self.control.check_running()?;
        let mut transfer = self.required_transfer(attachment_id)?;
        let material = material_from_transfer(&transfer).map_err(integrity_failure)?;
        let media_type = self
            .store
            .attachment_upload_media_type(attachment_id)
            .map_err(store_failure)?;
        let prepared = prepare_upload_with_media_type(
            self.blobs.as_ref(),
            &transfer.source_local_ref,
            &material,
            &transfer,
            &media_type,
        )
        .map_err(integrity_failure)?;
        self.store
            .update_attachment_transfer_prepared(
                attachment_id,
                &prepared.descriptor_sha256,
                &transfer.partial_local_ref,
                now_unix_ms,
            )
            .map_err(store_failure)?;
        transfer = self.required_transfer(attachment_id)?;
        if transfer.upload_id.is_empty() {
            let (upload_id, generation, bitmap) =
                self.transport.begin_upload(&transfer, &prepared)?;
            validate_bitmap(&bitmap, material.chunk_count()).map_err(integrity_failure)?;
            self.store.update_attachment_transfer_progress(
                attachment_id,
                AttachmentTransferState::Transferring as i32,
                &upload_id,
                generation,
                &bitmap,
                transfer.attempt_count,
                0,
                0,
                now_unix_ms,
            )?;
            transfer = self.required_transfer(attachment_id)?;
        }

        for chunk_index in 0..material.chunk_count() {
            self.control.check_running()?;
            if chunk_complete(&transfer.completed_chunk_bitmap, chunk_index) {
                continue;
            }
            let plaintext = read_plaintext_chunk(
                self.blobs.as_ref(),
                &transfer.source_local_ref,
                &material,
                chunk_index,
            )?;
            let encrypted = encrypt_attachment_chunk(&material, chunk_index, &plaintext)
                .map_err(integrity_failure)?;
            if encrypted.ciphertext_sha256
                != prepared.object.chunk_ciphertext_sha256[chunk_index as usize].as_slice()
            {
                return Err(integrity_failure(
                    "messaging attachment prepared chunk changed".to_string(),
                ));
            }
            self.transport.put_upload_chunk(&transfer, &encrypted)?;
            set_chunk_complete(&mut transfer.completed_chunk_bitmap, chunk_index);
            self.store.update_attachment_transfer_progress(
                attachment_id,
                AttachmentTransferState::Transferring as i32,
                &transfer.upload_id,
                transfer.generation,
                &transfer.completed_chunk_bitmap,
                transfer.attempt_count,
                0,
                0,
                now_unix_ms,
            )?;
        }
        let descriptor = self.transport.complete_upload(&transfer, &prepared)?;
        validate_encrypted_object_descriptor(&descriptor).map_err(integrity_failure)?;
        if descriptor.ciphertext_sha256 != prepared.object.ciphertext_sha256 {
            return Err(integrity_failure(
                "messaging attachment completion hash mismatch".to_string(),
            ));
        }
        self.store
            .complete_attachment_upload(&transfer, &descriptor, now_unix_ms)
            .map_err(store_failure)?;
        Ok(true)
    }

    fn download_once(
        &self,
        attachment_id: &str,
        descriptor: &EncryptedObjectDescriptor,
        expected_plaintext_sha256: &[u8; 32],
        cache_ref: &str,
        now_unix_ms: i64,
    ) -> Result<bool, AttachmentTransferFailure> {
        self.control.check_running()?;
        validate_encrypted_object_descriptor(descriptor).map_err(integrity_failure)?;
        let mut transfer = self.required_transfer(attachment_id)?;
        let material = material_from_transfer(&transfer).map_err(integrity_failure)?;
        if descriptor.chunk_count != material.chunk_count()
            || descriptor.chunk_size != material.chunk_size()
        {
            return Err(integrity_failure(
                "messaging attachment descriptor/material mismatch".to_string(),
            ));
        }
        let descriptor_hash: [u8; 32] =
            Sha256::digest(prost::Message::encode_to_vec(descriptor)).into();
        if transfer.descriptor_sha256 != vec![0; 32]
            && transfer.descriptor_sha256 != descriptor_hash
        {
            self.blobs.remove(&transfer.partial_local_ref)?;
            return Err(integrity_failure(
                "messaging attachment descriptor commitment changed".to_string(),
            ));
        }
        self.store
            .update_attachment_transfer_prepared(
                attachment_id,
                &descriptor_hash,
                &transfer.partial_local_ref,
                now_unix_ms,
            )
            .map_err(store_failure)?;
        transfer = self.required_transfer(attachment_id)?;
        validate_bitmap(&transfer.completed_chunk_bitmap, descriptor.chunk_count)
            .map_err(integrity_failure)?;
        if self.blobs.exists(cache_ref)? {
            if (0..descriptor.chunk_count)
                .all(|index| chunk_complete(&transfer.completed_chunk_bitmap, index))
                && self.blobs.sha256(cache_ref)? == *expected_plaintext_sha256
            {
                self.store
                    .complete_attachment_download(&transfer, descriptor, cache_ref, now_unix_ms)
                    .map_err(store_failure)?;
                return Ok(true);
            }
            self.blobs.remove(cache_ref)?;
            return Err(integrity_failure(
                "messaging attachment promoted cache is invalid".to_string(),
            ));
        }
        validate_partial_blob(self.blobs.as_ref(), &transfer, &material, descriptor)
            .map_err(integrity_failure)?;

        for chunk_index in 0..descriptor.chunk_count {
            self.control.check_running()?;
            if chunk_complete(&transfer.completed_chunk_bitmap, chunk_index) {
                continue;
            }
            let plaintext_size = plaintext_chunk_size(&material, chunk_index)?;
            let ciphertext_size = plaintext_size + ATTACHMENT_TAG_SIZE as usize;
            let start =
                u64::from(chunk_index) * u64::from(descriptor.chunk_size + descriptor.tag_size);
            let ciphertext = self.transport.get_download_chunk(
                &transfer,
                descriptor,
                chunk_index,
                start,
                start + ciphertext_size as u64 - 1,
            )?;
            let expected_hash: [u8; 32] = descriptor.chunk_ciphertext_sha256[chunk_index as usize]
                .as_slice()
                .try_into()
                .map_err(|_| {
                    integrity_failure(
                        "messaging attachment chunk commitment is invalid".to_string(),
                    )
                })?;
            let plaintext = decrypt_attachment_chunk(
                &material,
                &EncryptedAttachmentChunk {
                    chunk_index,
                    ciphertext,
                    ciphertext_sha256: expected_hash,
                },
            )
            .map_err(integrity_failure)?;
            self.blobs.write_chunk(
                &transfer.partial_local_ref,
                u64::from(chunk_index) * u64::from(material.chunk_size()),
                &plaintext,
            )?;
            set_chunk_complete(&mut transfer.completed_chunk_bitmap, chunk_index);
            self.store.update_attachment_transfer_progress(
                attachment_id,
                AttachmentTransferState::Transferring as i32,
                &transfer.upload_id,
                transfer.generation,
                &transfer.completed_chunk_bitmap,
                transfer.attempt_count,
                0,
                0,
                now_unix_ms,
            )?;
        }
        self.blobs
            .truncate(&transfer.partial_local_ref, material.plaintext_size())?;
        if self.blobs.sha256(&transfer.partial_local_ref)? != *expected_plaintext_sha256 {
            self.blobs.remove(&transfer.partial_local_ref)?;
            return Err(integrity_failure(
                "messaging attachment plaintext hash mismatch".to_string(),
            ));
        }
        self.blobs.promote(&transfer.partial_local_ref, cache_ref)?;
        self.store
            .complete_attachment_download(&transfer, descriptor, cache_ref, now_unix_ms)
            .map_err(store_failure)?;
        Ok(true)
    }

    pub fn cancel(&self, attachment_id: &str, now_unix_ms: i64) -> Result<(), String> {
        let transfer = self.required_transfer(attachment_id)?;
        if transfer.state == AttachmentTransferState::Complete as i32 {
            return Err("messaging attachment completed transfer cannot be cancelled".to_string());
        }
        if transfer.state == AttachmentTransferState::Cancelled as i32 {
            return Ok(());
        }
        if !transfer.upload_id.is_empty() {
            self.transport
                .cancel_upload(&transfer)
                .map_err(|failure| failure.to_string())?;
        }
        self.blobs.remove(&transfer.partial_local_ref)?;
        self.store.update_attachment_transfer_progress(
            attachment_id,
            AttachmentTransferState::Cancelled as i32,
            &transfer.upload_id,
            transfer.generation,
            &transfer.completed_chunk_bitmap,
            transfer.attempt_count,
            0,
            0,
            now_unix_ms,
        )
    }

    fn required_transfer(&self, attachment_id: &str) -> Result<AttachmentTransferRecord, String> {
        self.store
            .attachment_transfer(attachment_id)?
            .ok_or_else(|| "messaging attachment transfer is unavailable".to_string())
    }

    fn preflight(
        &self,
        attachment_id: &str,
        now_unix_ms: i64,
    ) -> Result<Option<AttachmentTransferProgress>, String> {
        let transfer = self.required_transfer(attachment_id)?;
        if transfer.state == AttachmentTransferState::Complete as i32 {
            return Ok(Some(AttachmentTransferProgress::Complete));
        }
        if transfer.state == AttachmentTransferState::Cancelled as i32
            || transfer.state == AttachmentTransferState::Terminal as i32
        {
            return Err("messaging attachment transfer is terminal".to_string());
        }
        if transfer.state == AttachmentTransferState::RetryWait as i32
            && transfer.next_attempt_at_unix_ms > now_unix_ms
        {
            return Ok(Some(AttachmentTransferProgress::Deferred {
                next_attempt_at_unix_ms: transfer.next_attempt_at_unix_ms,
            }));
        }
        Ok(None)
    }

    fn persist_failure(
        &self,
        attachment_id: &str,
        now_unix_ms: i64,
        failure: AttachmentTransferFailure,
    ) -> Result<AttachmentTransferProgress, String> {
        let transfer = self.required_transfer(attachment_id)?;
        if transfer.state == AttachmentTransferState::Complete as i32 {
            return Ok(AttachmentTransferProgress::Complete);
        }
        let attempt_count = transfer.attempt_count.saturating_add(1);
        if failure.retryable {
            let policy_delay = retry_delay_ms(
                attachment_id,
                attempt_count,
                self.retry_policy.initial_delay_ms,
                self.retry_policy.maximum_delay_ms,
            );
            let delay = failure
                .retry_after_ms
                .unwrap_or(0)
                .max(policy_delay)
                .min(self.retry_policy.maximum_delay_ms);
            let next_attempt_at_unix_ms = now_unix_ms.saturating_add(delay);
            self.store.update_attachment_transfer_progress(
                attachment_id,
                AttachmentTransferState::RetryWait as i32,
                &transfer.upload_id,
                transfer.generation,
                &transfer.completed_chunk_bitmap,
                attempt_count,
                next_attempt_at_unix_ms,
                failure.code as i32,
                now_unix_ms,
            )?;
            return Ok(AttachmentTransferProgress::RetryScheduled {
                next_attempt_at_unix_ms,
            });
        }
        self.store.update_attachment_transfer_progress(
            attachment_id,
            AttachmentTransferState::Terminal as i32,
            &transfer.upload_id,
            transfer.generation,
            &transfer.completed_chunk_bitmap,
            attempt_count,
            0,
            failure.code as i32,
            now_unix_ms,
        )?;
        Ok(AttachmentTransferProgress::Terminal { code: failure.code })
    }
}

fn retry_delay_ms(
    attachment_id: &str,
    attempt_count: u32,
    initial_delay_ms: i64,
    maximum_delay_ms: i64,
) -> i64 {
    let exponent = attempt_count.saturating_sub(1).min(30);
    let base = initial_delay_ms
        .saturating_mul(1_i64 << exponent)
        .min(maximum_delay_ms);
    let mut hash = Sha256::new();
    hash.update(attachment_id.as_bytes());
    hash.update(attempt_count.to_be_bytes());
    let digest = hash.finalize();
    let jitter_percent = 75 + i64::from(digest[0] % 51);
    base.saturating_mul(jitter_percent)
        .saturating_div(100)
        .min(maximum_delay_ms)
}

fn prepare_upload_with_media_type(
    blobs: &dyn AttachmentBlob,
    source_ref: &str,
    material: &AttachmentCryptoMaterial,
    transfer: &AttachmentTransferRecord,
    media_type: &str,
) -> Result<PreparedAttachmentUpload, String> {
    if media_type.trim().is_empty() || media_type.len() > 255 {
        return Err("messaging attachment media type is invalid".to_string());
    }
    if blobs.len(source_ref)? != material.plaintext_size() {
        return Err("messaging attachment source size changed".to_string());
    }
    let mut whole = Sha256::new();
    let mut chunk_hashes = Vec::with_capacity(material.chunk_count() as usize);
    let mut ciphertext_size = 0_u64;
    for chunk_index in 0..material.chunk_count() {
        let plaintext = read_plaintext_chunk(blobs, source_ref, material, chunk_index)?;
        let encrypted = encrypt_attachment_chunk(material, chunk_index, &plaintext)?;
        whole.update(&encrypted.ciphertext);
        ciphertext_size += encrypted.ciphertext.len() as u64;
        chunk_hashes.push(encrypted.ciphertext_sha256.to_vec());
    }
    let object = EncryptedObjectUploadSpec {
        ciphertext_size,
        ciphertext_sha256: whole.finalize().to_vec(),
        media_type: media_type.to_string(),
        chunk_size: material.chunk_size(),
        chunk_count: material.chunk_count(),
        encryption_suite: crate::proto::chat::AttachmentEncryptionSuite::Aes256GcmChunked as i32,
        tag_size: ATTACHMENT_TAG_SIZE,
        nonce_strategy: crate::proto::chat::AttachmentNonceStrategy::Counter32Be as i32,
        chunk_ciphertext_sha256: chunk_hashes,
    };
    let descriptor_sha256 = upload_commitment_fields(
        &transfer.conversation_id,
        &transfer.message_id,
        &transfer.attachment_id,
        &transfer.authority_station_id,
        &object,
    );
    Ok(PreparedAttachmentUpload {
        object,
        descriptor_sha256,
    })
}

#[cfg(test)]
fn prepare_upload(
    blobs: &dyn AttachmentBlob,
    source_ref: &str,
    material: &AttachmentCryptoMaterial,
    transfer: &AttachmentTransferRecord,
) -> Result<PreparedAttachmentUpload, String> {
    prepare_upload_with_media_type(
        blobs,
        source_ref,
        material,
        transfer,
        "application/octet-stream",
    )
}

pub fn upload_commitment_fields(
    conversation_id: &str,
    message_id: &str,
    attachment_id: &str,
    authority_station_id: &str,
    object: &EncryptedObjectUploadSpec,
) -> [u8; 32] {
    let mut hash = Sha256::new();
    let object_bytes = object.encode_to_vec();
    for value in [
        b"peers-touch:attachment:upload-commitment:1".as_slice(),
        conversation_id.as_bytes(),
        message_id.as_bytes(),
        attachment_id.as_bytes(),
        authority_station_id.as_bytes(),
        object_bytes.as_slice(),
    ] {
        hash.update((value.len() as u64).to_be_bytes());
        hash.update(value);
    }
    hash.finalize().into()
}

fn material_from_transfer(
    transfer: &AttachmentTransferRecord,
) -> Result<AttachmentCryptoMaterial, String> {
    AttachmentCryptoMaterial::from_parts(
        transfer
            .object_key
            .as_slice()
            .try_into()
            .map_err(|_| "invalid object key")?,
        transfer
            .base_nonce
            .as_slice()
            .try_into()
            .map_err(|_| "invalid base nonce")?,
        transfer.plaintext_size,
        transfer.chunk_size,
    )
}

fn read_plaintext_chunk(
    blobs: &dyn AttachmentBlob,
    blob_ref: &str,
    material: &AttachmentCryptoMaterial,
    index: u32,
) -> Result<Vec<u8>, String> {
    let size = plaintext_chunk_size(material, index)?;
    blobs.read_chunk(
        blob_ref,
        u64::from(index) * u64::from(material.chunk_size()),
        size,
    )
}

fn plaintext_chunk_size(material: &AttachmentCryptoMaterial, index: u32) -> Result<usize, String> {
    if index >= material.chunk_count() {
        return Err("messaging attachment chunk index exceeds policy".to_string());
    }
    let offset = u64::from(index) * u64::from(material.chunk_size());
    Ok((material.plaintext_size() - offset).min(u64::from(material.chunk_size())) as usize)
}

fn validate_bitmap(bitmap: &[u8], chunks: u32) -> Result<(), String> {
    if bitmap.len() != chunks.div_ceil(8) as usize {
        return Err("messaging attachment checkpoint bitmap mismatch".to_string());
    }
    Ok(())
}

fn chunk_complete(bitmap: &[u8], index: u32) -> bool {
    bitmap
        .get(index as usize / 8)
        .is_some_and(|byte| byte & (1 << (index % 8)) != 0)
}

fn set_chunk_complete(bitmap: &mut [u8], index: u32) {
    bitmap[index as usize / 8] |= 1 << (index % 8);
}

fn validate_partial_blob(
    blobs: &dyn AttachmentBlob,
    transfer: &AttachmentTransferRecord,
    material: &AttachmentCryptoMaterial,
    descriptor: &EncryptedObjectDescriptor,
) -> Result<(), String> {
    if !blobs.exists(&transfer.partial_local_ref)? {
        if transfer
            .completed_chunk_bitmap
            .iter()
            .any(|byte| *byte != 0)
        {
            return Err("messaging attachment partial file is missing".to_string());
        }
        return Ok(());
    }
    let expected_min = transfer
        .completed_chunk_bitmap
        .iter()
        .enumerate()
        .flat_map(|(byte_index, byte)| {
            (0..8).filter_map(move |bit| {
                if byte & (1 << bit) != 0 {
                    Some((byte_index * 8 + bit + 1) as u64)
                } else {
                    None
                }
            })
        })
        .max()
        .unwrap_or(0)
        .saturating_mul(u64::from(material.chunk_size()))
        .min(material.plaintext_size());
    if blobs.len(&transfer.partial_local_ref)? < expected_min {
        blobs.remove(&transfer.partial_local_ref)?;
        return Err("messaging attachment partial file checkpoint mismatch".to_string());
    }
    for chunk_index in 0..material.chunk_count() {
        if !chunk_complete(&transfer.completed_chunk_bitmap, chunk_index) {
            continue;
        }
        let plaintext =
            read_plaintext_chunk(blobs, &transfer.partial_local_ref, material, chunk_index)?;
        let encrypted = encrypt_attachment_chunk(material, chunk_index, &plaintext)?;
        if descriptor.chunk_ciphertext_sha256[chunk_index as usize] != encrypted.ciphertext_sha256 {
            blobs.remove(&transfer.partial_local_ref)?;
            return Err("messaging attachment partial file integrity mismatch".to_string());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;
    use ulid::Ulid;

    #[derive(Default)]
    struct MemoryBlob {
        blobs: Mutex<HashMap<String, Vec<u8>>>,
    }

    impl MemoryBlob {
        fn put(&self, blob_ref: &str, data: Vec<u8>) {
            self.blobs
                .lock()
                .unwrap()
                .insert(blob_ref.to_string(), data);
        }

        fn bytes(&self, blob_ref: &str) -> Option<Vec<u8>> {
            self.blobs.lock().unwrap().get(blob_ref).cloned()
        }
    }

    impl AttachmentBlob for MemoryBlob {
        fn exists(&self, blob_ref: &str) -> Result<bool, String> {
            Ok(self.blobs.lock().unwrap().contains_key(blob_ref))
        }

        fn len(&self, blob_ref: &str) -> Result<u64, String> {
            self.blobs
                .lock()
                .unwrap()
                .get(blob_ref)
                .map(|blob| blob.len() as u64)
                .ok_or_else(|| "test attachment blob is unavailable".to_string())
        }

        fn read_chunk(
            &self,
            blob_ref: &str,
            offset: u64,
            length: usize,
        ) -> Result<Vec<u8>, String> {
            let blobs = self.blobs.lock().unwrap();
            let blob = blobs
                .get(blob_ref)
                .ok_or_else(|| "test attachment blob is unavailable".to_string())?;
            let start = usize::try_from(offset)
                .map_err(|_| "test attachment blob offset is invalid".to_string())?;
            let end = start
                .checked_add(length)
                .filter(|end| *end <= blob.len())
                .ok_or_else(|| "test attachment blob range is invalid".to_string())?;
            Ok(blob[start..end].to_vec())
        }

        fn write_chunk(&self, blob_ref: &str, offset: u64, data: &[u8]) -> Result<(), String> {
            let start = usize::try_from(offset)
                .map_err(|_| "test attachment blob offset is invalid".to_string())?;
            let end = start
                .checked_add(data.len())
                .ok_or_else(|| "test attachment blob range is invalid".to_string())?;
            let mut blobs = self.blobs.lock().unwrap();
            let blob = blobs.entry(blob_ref.to_string()).or_default();
            blob.resize(blob.len().max(end), 0);
            blob[start..end].copy_from_slice(data);
            Ok(())
        }

        fn truncate(&self, blob_ref: &str, length: u64) -> Result<(), String> {
            let length = usize::try_from(length)
                .map_err(|_| "test attachment blob length is invalid".to_string())?;
            self.blobs
                .lock()
                .unwrap()
                .entry(blob_ref.to_string())
                .or_default()
                .resize(length, 0);
            Ok(())
        }

        fn sha256(&self, blob_ref: &str) -> Result<[u8; 32], String> {
            self.blobs
                .lock()
                .unwrap()
                .get(blob_ref)
                .map(|blob| Sha256::digest(blob).into())
                .ok_or_else(|| "test attachment blob is unavailable".to_string())
        }

        fn promote(&self, source_ref: &str, target_ref: &str) -> Result<(), String> {
            let mut blobs = self.blobs.lock().unwrap();
            let blob = blobs
                .remove(source_ref)
                .ok_or_else(|| "test attachment blob is unavailable".to_string())?;
            blobs.insert(target_ref.to_string(), blob);
            Ok(())
        }

        fn remove(&self, blob_ref: &str) -> Result<(), String> {
            self.blobs.lock().unwrap().remove(blob_ref);
            Ok(())
        }
    }

    #[derive(Default)]
    struct TestStore {
        transfers: Mutex<HashMap<String, AttachmentTransferRecord>>,
    }

    impl TestStore {
        fn new() -> Self {
            Self::default()
        }

        fn create_attachment_transfer(
            &self,
            transfer: &AttachmentTransferRecord,
        ) -> Result<bool, String> {
            let mut transfers = self.transfers.lock().map_err(|error| error.to_string())?;
            match transfers.get(&transfer.attachment_id) {
                Some(existing) if existing == transfer => Ok(false),
                Some(_) => Err("messaging attachment transfer identity conflict".to_string()),
                None => {
                    transfers.insert(transfer.attachment_id.clone(), transfer.clone());
                    Ok(true)
                }
            }
        }

        fn attachment_transfer(
            &self,
            attachment_id: &str,
        ) -> Result<Option<AttachmentTransferRecord>, String> {
            AttachmentTransferRepository::attachment_transfer(self, attachment_id)
        }

        #[allow(clippy::too_many_arguments)]
        fn update_attachment_transfer_progress(
            &self,
            attachment_id: &str,
            state: i32,
            upload_id: &str,
            generation: u64,
            completed_chunk_bitmap: &[u8],
            attempt_count: u32,
            next_attempt_at_unix_ms: i64,
            last_error_code: i32,
            updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            AttachmentTransferRepository::update_attachment_transfer_progress(
                self,
                attachment_id,
                state,
                upload_id,
                generation,
                completed_chunk_bitmap,
                attempt_count,
                next_attempt_at_unix_ms,
                last_error_code,
                updated_at_unix_ms,
            )
        }
    }

    impl AttachmentTransferRepository for TestStore {
        fn attachment_transfer(
            &self,
            attachment_id: &str,
        ) -> Result<Option<AttachmentTransferRecord>, String> {
            Ok(self
                .transfers
                .lock()
                .map_err(|error| error.to_string())?
                .get(attachment_id)
                .cloned())
        }

        fn attachment_upload_media_type(&self, _attachment_id: &str) -> Result<String, String> {
            Ok("application/octet-stream".to_string())
        }

        fn update_attachment_transfer_prepared(
            &self,
            attachment_id: &str,
            descriptor_sha256: &[u8],
            partial_local_ref: &str,
            updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            let mut transfers = self.transfers.lock().map_err(|error| error.to_string())?;
            let transfer = transfers
                .get_mut(attachment_id)
                .ok_or_else(|| "messaging attachment progress target is unavailable".to_string())?;
            if transfer.descriptor_sha256 != vec![0; 32]
                && transfer.descriptor_sha256 != descriptor_sha256
            {
                return Err("messaging attachment descriptor commitment changed".to_string());
            }
            transfer.descriptor_sha256 = descriptor_sha256.to_vec();
            transfer.partial_local_ref = partial_local_ref.to_string();
            transfer.updated_at_unix_ms = updated_at_unix_ms;
            Ok(())
        }

        fn update_attachment_transfer_progress(
            &self,
            attachment_id: &str,
            state: i32,
            upload_id: &str,
            generation: u64,
            completed_chunk_bitmap: &[u8],
            attempt_count: u32,
            next_attempt_at_unix_ms: i64,
            last_error_code: i32,
            updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            let mut transfers = self.transfers.lock().map_err(|error| error.to_string())?;
            let transfer = transfers
                .get_mut(attachment_id)
                .ok_or_else(|| "messaging attachment progress target is unavailable".to_string())?;
            transfer.state = state;
            transfer.upload_id = upload_id.to_string();
            transfer.generation = generation;
            transfer.completed_chunk_bitmap = completed_chunk_bitmap.to_vec();
            transfer.attempt_count = attempt_count;
            transfer.next_attempt_at_unix_ms = next_attempt_at_unix_ms;
            transfer.last_error_code = last_error_code;
            transfer.updated_at_unix_ms = updated_at_unix_ms;
            Ok(())
        }

        fn complete_attachment_upload(
            &self,
            transfer: &AttachmentTransferRecord,
            _descriptor: &EncryptedObjectDescriptor,
            updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            self.update_attachment_transfer_progress(
                &transfer.attachment_id,
                AttachmentTransferState::Complete as i32,
                &transfer.upload_id,
                transfer.generation,
                &transfer.completed_chunk_bitmap,
                transfer.attempt_count,
                0,
                0,
                updated_at_unix_ms,
            )
        }

        fn complete_attachment_download(
            &self,
            transfer: &AttachmentTransferRecord,
            _descriptor: &EncryptedObjectDescriptor,
            _cache_path: &str,
            updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            self.complete_attachment_upload(transfer, _descriptor, updated_at_unix_ms)
        }
    }

    struct MemoryTransport {
        chunks: Mutex<HashMap<u32, Vec<u8>>>,
        upload_calls: Mutex<Vec<u32>>,
        fail_upload_once: Mutex<Option<u32>>,
        fail_download_once: Mutex<Option<u32>>,
        retain_uploads: bool,
        corrupt_download_once: Mutex<Option<u32>>,
        reject_etag: Mutex<bool>,
        cancel_calls: Mutex<usize>,
    }

    impl MemoryTransport {
        fn new() -> Self {
            Self {
                chunks: Mutex::new(HashMap::new()),
                upload_calls: Mutex::new(Vec::new()),
                fail_upload_once: Mutex::new(None),
                fail_download_once: Mutex::new(None),
                retain_uploads: true,
                corrupt_download_once: Mutex::new(None),
                reject_etag: Mutex::new(false),
                cancel_calls: Mutex::new(0),
            }
        }

        fn without_upload_retention() -> Self {
            Self {
                retain_uploads: false,
                ..Self::new()
            }
        }
    }

    impl AttachmentTransferTransport for MemoryTransport {
        fn begin_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
            prepared: &PreparedAttachmentUpload,
        ) -> Result<(String, u64, Vec<u8>), AttachmentTransferFailure> {
            Ok((
                "upload-1".to_string(),
                1,
                vec![0; prepared.object.chunk_count.div_ceil(8) as usize],
            ))
        }

        fn put_upload_chunk(
            &self,
            _transfer: &AttachmentTransferRecord,
            chunk: &EncryptedAttachmentChunk,
        ) -> Result<(), AttachmentTransferFailure> {
            self.upload_calls.lock().unwrap().push(chunk.chunk_index);
            if *self.fail_upload_once.lock().unwrap() == Some(chunk.chunk_index) {
                *self.fail_upload_once.lock().unwrap() = None;
                return Err(AttachmentTransferFailure::from(
                    "injected upload interruption".to_string(),
                ));
            }
            if self.retain_uploads {
                self.chunks
                    .lock()
                    .unwrap()
                    .insert(chunk.chunk_index, chunk.ciphertext.clone());
            }
            Ok(())
        }

        fn complete_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
            prepared: &PreparedAttachmentUpload,
        ) -> Result<EncryptedObjectDescriptor, AttachmentTransferFailure> {
            Ok(EncryptedObjectDescriptor {
                object_id: "object-1".to_string(),
                storage_ref: "opaque-1".to_string(),
                ciphertext_size: prepared.object.ciphertext_size,
                ciphertext_sha256: prepared.object.ciphertext_sha256.clone(),
                media_type: prepared.object.media_type.clone(),
                chunk_size: prepared.object.chunk_size,
                chunk_count: prepared.object.chunk_count,
                encryption_suite: prepared.object.encryption_suite,
                tag_size: prepared.object.tag_size,
                nonce_strategy: prepared.object.nonce_strategy,
                chunk_ciphertext_sha256: prepared.object.chunk_ciphertext_sha256.clone(),
            })
        }

        fn get_download_chunk(
            &self,
            _transfer: &AttachmentTransferRecord,
            _descriptor: &EncryptedObjectDescriptor,
            chunk_index: u32,
            _start: u64,
            _end: u64,
        ) -> Result<Vec<u8>, AttachmentTransferFailure> {
            if *self.reject_etag.lock().unwrap() {
                return Err(AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    "messaging attachment range status 412 Precondition Failed".to_string(),
                ));
            }
            if *self.fail_download_once.lock().unwrap() == Some(chunk_index) {
                *self.fail_download_once.lock().unwrap() = None;
                return Err(AttachmentTransferFailure::from(
                    "injected download interruption".to_string(),
                ));
            }
            let mut bytes = self
                .chunks
                .lock()
                .unwrap()
                .get(&chunk_index)
                .cloned()
                .ok_or_else(|| {
                    AttachmentTransferFailure::terminal(
                        AttachmentTransferErrorCode::IntegrityFailed,
                        "missing remote chunk".to_string(),
                    )
                })?;
            if *self.corrupt_download_once.lock().unwrap() == Some(chunk_index) {
                *self.corrupt_download_once.lock().unwrap() = None;
                bytes[0] ^= 1;
            }
            Ok(bytes)
        }

        fn cancel_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
        ) -> Result<(), AttachmentTransferFailure> {
            *self.cancel_calls.lock().unwrap() += 1;
            Ok(())
        }
    }

    struct GeneratedDownloadTransport {
        plaintext_size: u64,
        chunk_size: u32,
        download_calls: Mutex<Vec<u32>>,
    }

    impl AttachmentTransferTransport for GeneratedDownloadTransport {
        fn begin_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
            _prepared: &PreparedAttachmentUpload,
        ) -> Result<(String, u64, Vec<u8>), AttachmentTransferFailure> {
            Err(test_unsupported_transport_operation())
        }

        fn put_upload_chunk(
            &self,
            _transfer: &AttachmentTransferRecord,
            _chunk: &EncryptedAttachmentChunk,
        ) -> Result<(), AttachmentTransferFailure> {
            Err(test_unsupported_transport_operation())
        }

        fn complete_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
            _prepared: &PreparedAttachmentUpload,
        ) -> Result<EncryptedObjectDescriptor, AttachmentTransferFailure> {
            Err(test_unsupported_transport_operation())
        }

        fn get_download_chunk(
            &self,
            _transfer: &AttachmentTransferRecord,
            _descriptor: &EncryptedObjectDescriptor,
            chunk_index: u32,
            _start: u64,
            _end: u64,
        ) -> Result<Vec<u8>, AttachmentTransferFailure> {
            self.download_calls.lock().unwrap().push(chunk_index);
            let material = AttachmentCryptoMaterial::from_parts(
                [7; 32],
                [0; 12],
                self.plaintext_size,
                self.chunk_size,
            )
            .map_err(AttachmentTransferFailure::from)?;
            let plaintext = vec![0; plaintext_chunk_size(&material, chunk_index)?];
            Ok(encrypt_attachment_chunk(&material, chunk_index, &plaintext)?.ciphertext)
        }

        fn cancel_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
        ) -> Result<(), AttachmentTransferFailure> {
            Err(test_unsupported_transport_operation())
        }
    }

    fn test_unsupported_transport_operation() -> AttachmentTransferFailure {
        AttachmentTransferFailure::terminal(
            AttachmentTransferErrorCode::DescriptorMismatch,
            "unsupported test transport operation".to_string(),
        )
    }

    fn temp_ref(label: &str) -> String {
        format!("memory://pt-attachment-{label}-{}", Ulid::new())
    }

    fn transfer(
        attachment_id: &str,
        source_ref: &str,
        partial_ref: &str,
        plaintext_size: u64,
        chunk_size: u32,
    ) -> AttachmentTransferRecord {
        AttachmentTransferRecord {
            attachment_id: attachment_id.to_string(),
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            authority_station_id: "station-1".to_string(),
            direction: 1,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![
                0;
                plaintext_size.div_ceil(chunk_size as u64).div_ceil(8)
                    as usize
            ],
            source_local_ref: source_ref.to_string(),
            partial_local_ref: partial_ref.to_string(),
            object_key: vec![7; 32],
            base_nonce: vec![0; 12],
            plaintext_size,
            chunk_size,
            attempt_count: 0,
            next_attempt_at_unix_ms: 1,
            last_error_code: 0,
            updated_at_unix_ms: 1,
        }
    }

    #[test]
    fn upload_resumes_from_durable_bitmap_without_replaying_completed_chunk() {
        let source = temp_ref("upload-source");
        let partial = temp_ref("upload-partial");
        let plaintext = (0..(2 * 1024 * 1024 + 41))
            .map(|value| value as u8)
            .collect::<Vec<_>>();
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let store = Arc::new(TestStore::new());
        let record = transfer(
            "upload-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        store.create_attachment_transfer(&record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        *transport.fail_upload_once.lock().unwrap() = Some(1);
        let worker = AttachmentTransferWorker::new(store.clone(), transport.clone(), blobs.clone());

        assert!(worker.upload_once("upload-transfer", 10).is_err());
        assert_eq!(
            store
                .attachment_transfer("upload-transfer")
                .unwrap()
                .unwrap()
                .completed_chunk_bitmap,
            vec![1]
        );
        worker.upload_once("upload-transfer", 11).unwrap();
        assert_eq!(*transport.upload_calls.lock().unwrap(), vec![0, 1, 1, 2]);
        assert_eq!(
            store
                .attachment_transfer("upload-transfer")
                .unwrap()
                .unwrap()
                .state,
            AttachmentTransferState::Complete as i32
        );
    }

    #[test]
    fn upload_resumes_after_interruption_at_every_chunk() {
        let source = temp_ref("upload-every-chunk-source");
        let partial = temp_ref("upload-every-chunk-partial");
        let plaintext = vec![37_u8; 2 * 1024 * 1024 + 41];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());

        for interrupted_chunk in 0..3 {
            let attachment_id = format!("upload-every-chunk-{interrupted_chunk}");
            let store = Arc::new(TestStore::new());
            let record = transfer(
                &attachment_id,
                &source,
                &partial,
                plaintext.len() as u64,
                1024 * 1024,
            );
            store.create_attachment_transfer(&record).unwrap();
            let transport = Arc::new(MemoryTransport::new());
            *transport.fail_upload_once.lock().unwrap() = Some(interrupted_chunk);
            let worker =
                AttachmentTransferWorker::new(store.clone(), transport.clone(), blobs.clone());

            assert!(worker.upload_once(&attachment_id, 10).is_err());
            let interrupted = store.attachment_transfer(&attachment_id).unwrap().unwrap();
            for chunk_index in 0..3 {
                assert_eq!(
                    chunk_complete(&interrupted.completed_chunk_bitmap, chunk_index),
                    chunk_index < interrupted_chunk
                );
            }

            worker.upload_once(&attachment_id, 11).unwrap();
            let calls = transport.upload_calls.lock().unwrap();
            for chunk_index in 0..3 {
                assert_eq!(
                    calls
                        .iter()
                        .filter(|called| **called == chunk_index)
                        .count(),
                    if chunk_index == interrupted_chunk {
                        2
                    } else {
                        1
                    }
                );
            }
            assert_eq!(
                store
                    .attachment_transfer(&attachment_id)
                    .unwrap()
                    .unwrap()
                    .state,
                AttachmentTransferState::Complete as i32
            );
        }
    }

    #[test]
    fn download_resumes_then_atomically_promotes_verified_plaintext() {
        let source = temp_ref("download-source");
        let partial = temp_ref("download-partial");
        let cache = temp_ref("download-cache");
        let plaintext = (0..(2 * 1024 * 1024 + 41))
            .map(|value| (value * 3) as u8)
            .collect::<Vec<_>>();
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let material = AttachmentCryptoMaterial::from_parts(
            [7; 32],
            [0; 12],
            plaintext.len() as u64,
            1024 * 1024,
        )
        .unwrap();
        let upload_record = transfer(
            "unused",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let prepared = prepare_upload(blobs.as_ref(), &source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        for index in 0..material.chunk_count() {
            let chunk = read_plaintext_chunk(blobs.as_ref(), &source, &material, index).unwrap();
            let encrypted = encrypt_attachment_chunk(&material, index, &chunk).unwrap();
            transport
                .chunks
                .lock()
                .unwrap()
                .insert(index, encrypted.ciphertext);
        }
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let plaintext_hash: [u8; 32] = Sha256::digest(&plaintext).into();
        let store = Arc::new(TestStore::new());
        let mut record = transfer(
            "download-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        record.direction = 2;
        record.source_local_ref.clear();
        store.create_attachment_transfer(&record).unwrap();
        *transport.fail_download_once.lock().unwrap() = Some(1);
        let worker = AttachmentTransferWorker::new(store.clone(), transport.clone(), blobs.clone());

        assert!(worker
            .download_once(
                "download-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                10,
            )
            .is_err());
        assert!(blobs.exists(&partial).unwrap());
        assert!(!blobs.exists(&cache).unwrap());
        worker
            .download_once(
                "download-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                11,
            )
            .unwrap();
        assert_eq!(blobs.bytes(&cache).unwrap(), plaintext);
        assert!(!blobs.exists(&partial).unwrap());
    }

    #[test]
    fn download_resumes_after_interruption_at_every_chunk() {
        let source = temp_ref("download-every-chunk-source");
        let plaintext = vec![53_u8; 2 * 1024 * 1024 + 41];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let material = AttachmentCryptoMaterial::from_parts(
            [7; 32],
            [0; 12],
            plaintext.len() as u64,
            1024 * 1024,
        )
        .unwrap();
        let upload_record = transfer(
            "download-every-chunk-upload",
            &source,
            &temp_ref("download-every-chunk-unused"),
            plaintext.len() as u64,
            1024 * 1024,
        );
        let prepared = prepare_upload(blobs.as_ref(), &source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        for chunk_index in 0..material.chunk_count() {
            let plaintext_chunk =
                read_plaintext_chunk(blobs.as_ref(), &source, &material, chunk_index).unwrap();
            let encrypted =
                encrypt_attachment_chunk(&material, chunk_index, &plaintext_chunk).unwrap();
            transport
                .chunks
                .lock()
                .unwrap()
                .insert(chunk_index, encrypted.ciphertext);
        }
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let plaintext_hash: [u8; 32] = Sha256::digest(&plaintext).into();

        for interrupted_chunk in 0..3 {
            let attachment_id = format!("download-every-chunk-{interrupted_chunk}");
            let partial = temp_ref(&format!("download-every-chunk-partial-{interrupted_chunk}"));
            let cache = temp_ref(&format!("download-every-chunk-cache-{interrupted_chunk}"));
            let store = Arc::new(TestStore::new());
            let mut record = transfer(
                &attachment_id,
                &source,
                &partial,
                plaintext.len() as u64,
                1024 * 1024,
            );
            record.direction = 2;
            record.source_local_ref.clear();
            store.create_attachment_transfer(&record).unwrap();
            *transport.fail_download_once.lock().unwrap() = Some(interrupted_chunk);
            let worker =
                AttachmentTransferWorker::new(store.clone(), transport.clone(), blobs.clone());

            assert!(worker
                .download_once(&attachment_id, &descriptor, &plaintext_hash, &cache, 10,)
                .is_err());
            let interrupted = store.attachment_transfer(&attachment_id).unwrap().unwrap();
            for chunk_index in 0..3 {
                assert_eq!(
                    chunk_complete(&interrupted.completed_chunk_bitmap, chunk_index),
                    chunk_index < interrupted_chunk
                );
            }

            worker
                .download_once(&attachment_id, &descriptor, &plaintext_hash, &cache, 11)
                .unwrap();
            assert_eq!(blobs.bytes(&cache).unwrap(), plaintext);
            assert!(!blobs.exists(&partial).unwrap());
            blobs.remove(&cache).unwrap();
        }
    }

    #[test]
    fn partial_checkpoint_mismatch_is_deleted_and_fails_closed() {
        let source = temp_ref("mismatch-source");
        let partial = temp_ref("mismatch-partial");
        let cache = temp_ref("mismatch-cache");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![1_u8; 1024 * 1024 + 17]);
        blobs.put(&partial, vec![1_u8; 2]);
        let material =
            AttachmentCryptoMaterial::from_parts([7; 32], [0; 12], 1024 * 1024 + 17, 1024 * 1024)
                .unwrap();
        let upload_record = transfer("unused", &source, &partial, 1024 * 1024 + 17, 1024 * 1024);
        let prepared = prepare_upload(blobs.as_ref(), &source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let store = Arc::new(TestStore::new());
        let mut record = transfer(
            "mismatch-transfer",
            &source,
            &partial,
            1024 * 1024 + 17,
            1024 * 1024,
        );
        record.direction = 2;
        record.source_local_ref.clear();
        record.completed_chunk_bitmap = vec![1];
        store.create_attachment_transfer(&record).unwrap();
        let worker = AttachmentTransferWorker::new(store, transport, blobs.clone());
        assert!(worker
            .download_once("mismatch-transfer", &descriptor, &[0; 32], &cache, 10)
            .is_err());
        assert!(!blobs.exists(&partial).unwrap());
    }

    #[test]
    fn same_length_partial_corruption_is_deleted_and_fails_closed() {
        let source = temp_ref("corrupt-partial-source");
        let partial = temp_ref("corrupt-partial");
        let cache = temp_ref("corrupt-partial-cache");
        let plaintext = vec![7_u8; 2 * 1024 * 1024 + 17];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        blobs.put(&partial, vec![9_u8; 1024 * 1024]);
        let material = AttachmentCryptoMaterial::from_parts(
            [7; 32],
            [0; 12],
            plaintext.len() as u64,
            1024 * 1024,
        )
        .unwrap();
        let upload_record = transfer(
            "unused",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let prepared = prepare_upload(blobs.as_ref(), &source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let store = Arc::new(TestStore::new());
        let mut record = transfer(
            "corrupt-partial-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        record.direction = 2;
        record.source_local_ref.clear();
        record.completed_chunk_bitmap = vec![1];
        store.create_attachment_transfer(&record).unwrap();

        let worker = AttachmentTransferWorker::new(store, transport, blobs.clone());
        assert!(worker
            .download_once(
                "corrupt-partial-transfer",
                &descriptor,
                &Sha256::digest(&plaintext).into(),
                &cache,
                10,
            )
            .is_err());
        assert!(!blobs.exists(&partial).unwrap());
        assert!(!blobs.exists(&cache).unwrap());
    }

    #[test]
    fn corrupt_download_chunk_and_wrong_etag_fail_closed() {
        let source = temp_ref("corrupt-download-source");
        let partial = temp_ref("corrupt-download-partial");
        let cache = temp_ref("corrupt-download-cache");
        let plaintext = vec![5_u8; 1024 * 1024 + 17];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let material = AttachmentCryptoMaterial::from_parts(
            [7; 32],
            [0; 12],
            plaintext.len() as u64,
            1024 * 1024,
        )
        .unwrap();
        let upload_record = transfer(
            "unused",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let prepared = prepare_upload(blobs.as_ref(), &source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        for index in 0..material.chunk_count() {
            let chunk = read_plaintext_chunk(blobs.as_ref(), &source, &material, index).unwrap();
            let encrypted = encrypt_attachment_chunk(&material, index, &chunk).unwrap();
            transport
                .chunks
                .lock()
                .unwrap()
                .insert(index, encrypted.ciphertext);
        }
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let plaintext_hash: [u8; 32] = Sha256::digest(&plaintext).into();
        let store = Arc::new(TestStore::new());
        let mut record = transfer(
            "corrupt-download-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        record.direction = 2;
        record.source_local_ref.clear();
        store.create_attachment_transfer(&record).unwrap();
        let worker = AttachmentTransferWorker::new(store, transport.clone(), blobs.clone());

        *transport.corrupt_download_once.lock().unwrap() = Some(0);
        assert!(worker
            .download_once(
                "corrupt-download-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                10,
            )
            .is_err());
        assert!(!blobs.exists(&cache).unwrap());

        *transport.reject_etag.lock().unwrap() = true;
        assert!(worker
            .download_once(
                "corrupt-download-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                11,
            )
            .is_err());
        assert!(!blobs.exists(&cache).unwrap());
        blobs.remove(&partial).unwrap();
    }

    #[test]
    fn hundred_mib_upload_resumes_at_quarter_boundaries() {
        const SIZE: u64 = 100 * 1024 * 1024;
        const CHUNKS: u32 = 100;
        let source = temp_ref("hundred-mib-source");
        let partial = temp_ref("hundred-mib-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![0; SIZE as usize]);

        for completed_chunks in [25_u32, 50, 75] {
            let attachment_id = format!("hundred-mib-{completed_chunks}");
            let store = Arc::new(TestStore::new());
            let mut record = transfer(&attachment_id, &source, &partial, SIZE, 1024 * 1024);
            record.upload_id = format!("upload-{completed_chunks}");
            record.generation = 1;
            for index in 0..completed_chunks {
                set_chunk_complete(&mut record.completed_chunk_bitmap, index);
            }
            store.create_attachment_transfer(&record).unwrap();
            let transport = Arc::new(MemoryTransport::without_upload_retention());
            let worker =
                AttachmentTransferWorker::new(store.clone(), transport.clone(), blobs.clone());

            worker.upload_once(&attachment_id, 10).unwrap();

            let calls = transport.upload_calls.lock().unwrap();
            assert_eq!(calls.len(), (CHUNKS - completed_chunks) as usize);
            assert_eq!(calls.first().copied(), Some(completed_chunks));
            assert_eq!(calls.last().copied(), Some(CHUNKS - 1));
            assert_eq!(
                store
                    .attachment_transfer(&attachment_id)
                    .unwrap()
                    .unwrap()
                    .state,
                AttachmentTransferState::Complete as i32
            );
        }
    }

    #[test]
    fn hundred_mib_download_resumes_at_quarter_boundaries() {
        const SIZE: u64 = 100 * 1024 * 1024;
        const CHUNKS: u32 = 100;
        let source = temp_ref("hundred-mib-download-source");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![0; SIZE as usize]);
        let material =
            AttachmentCryptoMaterial::from_parts([7; 32], [0; 12], SIZE, 1024 * 1024).unwrap();
        let descriptor_record = transfer(
            "descriptor",
            &source,
            &temp_ref("descriptor-partial"),
            SIZE,
            1024 * 1024,
        );
        let prepared =
            prepare_upload(blobs.as_ref(), &source, &material, &descriptor_record).unwrap();
        let descriptor = MemoryTransport::new()
            .complete_upload(&descriptor_record, &prepared)
            .unwrap();
        let plaintext_hash = blobs.sha256(&source).unwrap();

        for completed_chunks in [25_u32, 50, 75] {
            let attachment_id = format!("hundred-mib-download-{completed_chunks}");
            let partial = temp_ref(&format!("hundred-mib-download-partial-{completed_chunks}"));
            let cache = temp_ref(&format!("hundred-mib-download-cache-{completed_chunks}"));
            blobs.put(&partial, vec![0; completed_chunks as usize * 1024 * 1024]);
            let store = Arc::new(TestStore::new());
            let mut record = transfer(&attachment_id, &source, &partial, SIZE, 1024 * 1024);
            record.direction = 2;
            record.source_local_ref.clear();
            for index in 0..completed_chunks {
                set_chunk_complete(&mut record.completed_chunk_bitmap, index);
            }
            store.create_attachment_transfer(&record).unwrap();
            let transport = Arc::new(GeneratedDownloadTransport {
                plaintext_size: SIZE,
                chunk_size: 1024 * 1024,
                download_calls: Mutex::new(Vec::new()),
            });
            let worker = AttachmentTransferWorker::new(store, transport.clone(), blobs.clone());

            worker
                .download_once(&attachment_id, &descriptor, &plaintext_hash, &cache, 10)
                .unwrap();

            let calls = transport.download_calls.lock().unwrap();
            assert_eq!(calls.len(), (CHUNKS - completed_chunks) as usize);
            assert_eq!(calls.first().copied(), Some(completed_chunks));
            assert_eq!(calls.last().copied(), Some(CHUNKS - 1));
            assert_eq!(blobs.sha256(&cache).unwrap(), plaintext_hash);
            assert!(!blobs.exists(&partial).unwrap());
            blobs.remove(&cache).unwrap();
        }
    }

    #[test]
    fn explicit_cancel_aborts_remote_session_and_persists_terminal_state() {
        let source = temp_ref("cancel-source");
        let partial = temp_ref("cancel-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![1_u8; 1024 * 1024]);
        blobs.put(&partial, vec![2_u8; 1024]);
        let store = Arc::new(TestStore::new());
        let mut record = transfer(
            "cancel-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        );
        record.upload_id = "upload-cancel".to_string();
        record.generation = 7;
        store.create_attachment_transfer(&record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        let worker = AttachmentTransferWorker::new(store.clone(), transport.clone(), blobs.clone());

        worker.cancel("cancel-transfer", 10).unwrap();
        worker.cancel("cancel-transfer", 11).unwrap();

        assert_eq!(*transport.cancel_calls.lock().unwrap(), 1);
        assert!(!blobs.exists(&partial).unwrap());
        assert_eq!(
            store
                .attachment_transfer("cancel-transfer")
                .unwrap()
                .unwrap()
                .state,
            AttachmentTransferState::Cancelled as i32
        );
    }

    #[test]
    fn retryable_failure_persists_jittered_backoff_and_respects_due_time() {
        let source = temp_ref("retry-source");
        let partial = temp_ref("retry-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![3_u8; 1024 * 1024]);
        let store = Arc::new(TestStore::new());
        let record = transfer(
            "retry-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        );
        store.create_attachment_transfer(&record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        *transport.fail_upload_once.lock().unwrap() = Some(0);
        let worker = AttachmentTransferWorker::new(store.clone(), transport.clone(), blobs.clone());

        let scheduled = worker.run_upload_once("retry-transfer", 10_000).unwrap();
        let next_attempt_at_unix_ms = match scheduled {
            AttachmentTransferProgress::RetryScheduled {
                next_attempt_at_unix_ms,
            } => next_attempt_at_unix_ms,
            other => panic!("expected retry, got {other:?}"),
        };
        assert!((10_750..=11_250).contains(&next_attempt_at_unix_ms));
        let persisted = store
            .attachment_transfer("retry-transfer")
            .unwrap()
            .unwrap();
        assert_eq!(persisted.state, AttachmentTransferState::RetryWait as i32);
        assert_eq!(persisted.attempt_count, 1);
        assert_eq!(
            persisted.last_error_code,
            AttachmentTransferErrorCode::RetryLater as i32
        );
        assert_eq!(
            worker
                .run_upload_once("retry-transfer", next_attempt_at_unix_ms - 1)
                .unwrap(),
            AttachmentTransferProgress::Deferred {
                next_attempt_at_unix_ms
            }
        );
        assert_eq!(*transport.upload_calls.lock().unwrap(), vec![0]);

        assert_eq!(
            worker
                .run_upload_once("retry-transfer", next_attempt_at_unix_ms)
                .unwrap(),
            AttachmentTransferProgress::Complete
        );
    }

    #[test]
    fn integrity_failure_is_terminal_and_not_retried() {
        let source = temp_ref("terminal-source");
        let partial = temp_ref("terminal-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![1_u8]);
        let store = Arc::new(TestStore::new());
        let record = transfer(
            "terminal-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        );
        store.create_attachment_transfer(&record).unwrap();
        let worker =
            AttachmentTransferWorker::new(store.clone(), Arc::new(MemoryTransport::new()), blobs);

        assert_eq!(
            worker.run_upload_once("terminal-transfer", 10_000).unwrap(),
            AttachmentTransferProgress::Terminal {
                code: AttachmentTransferErrorCode::IntegrityFailed
            }
        );
        let persisted = store
            .attachment_transfer("terminal-transfer")
            .unwrap()
            .unwrap();
        assert_eq!(persisted.state, AttachmentTransferState::Terminal as i32);
        assert_eq!(persisted.next_attempt_at_unix_ms, 0);
        assert!(worker.run_upload_once("terminal-transfer", 20_000).is_err());
    }

    #[test]
    fn server_retry_after_takes_precedence_and_remains_capped() {
        let source = temp_ref("retry-after-source");
        let partial = temp_ref("retry-after-partial");
        let store = Arc::new(TestStore::new());
        let record = transfer(
            "retry-after-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        );
        store.create_attachment_transfer(&record).unwrap();
        let worker = AttachmentTransferWorker::new(
            store.clone(),
            Arc::new(MemoryTransport::new()),
            Arc::new(MemoryBlob::default()),
        );

        assert_eq!(
            worker
                .persist_failure(
                    "retry-after-transfer",
                    10_000,
                    AttachmentTransferFailure::retryable(
                        AttachmentTransferErrorCode::QuotaExceeded,
                        Some(600_000),
                        "station quota".to_string(),
                    ),
                )
                .unwrap(),
            AttachmentTransferProgress::RetryScheduled {
                next_attempt_at_unix_ms: 310_000
            }
        );
        let persisted = store
            .attachment_transfer("retry-after-transfer")
            .unwrap()
            .unwrap();
        assert_eq!(persisted.next_attempt_at_unix_ms, 310_000);
        assert_eq!(
            persisted.last_error_code,
            AttachmentTransferErrorCode::QuotaExceeded as i32
        );
    }

    #[test]
    fn shutdown_and_fifth_active_transfer_are_durably_deferred() {
        let source = temp_ref("bounded-source");
        let partial = temp_ref("bounded-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![4_u8; 1024 * 1024]);
        let control = Arc::new(AttachmentTransferControl::new());
        let permits = (0..ATTACHMENT_MAX_ACTIVE_TRANSFERS)
            .map(|index| control.try_admit(&format!("active-{index}")).unwrap())
            .collect::<Vec<_>>();
        let store = Arc::new(TestStore::new());
        let record = transfer(
            "bounded-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        );
        store.create_attachment_transfer(&record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        let worker = AttachmentTransferWorker::with_control(
            store.clone(),
            transport.clone(),
            blobs,
            control.clone(),
            AttachmentRetryPolicy::default(),
        )
        .unwrap();

        assert!(matches!(
            worker.run_upload_once("bounded-transfer", 10_000).unwrap(),
            AttachmentTransferProgress::RetryScheduled { .. }
        ));
        drop(permits);
        let due = store
            .attachment_transfer("bounded-transfer")
            .unwrap()
            .unwrap()
            .next_attempt_at_unix_ms;
        control.request_shutdown();
        assert!(matches!(
            worker.run_upload_once("bounded-transfer", due).unwrap(),
            AttachmentTransferProgress::RetryScheduled { .. }
        ));
        assert!(transport.upload_calls.lock().unwrap().is_empty());
    }

    #[test]
    fn transfer_control_admits_each_attachment_once_until_release() {
        let control = AttachmentTransferControl::new();
        let first = control.try_admit("attachment-1").unwrap();

        assert!(matches!(
            control.try_admit("attachment-1"),
            Err(AttachmentAdmissionError::AlreadyActive)
        ));
        let second = control.try_admit("attachment-2").unwrap();
        assert_eq!(control.active.load(Ordering::Acquire), 2);

        drop(first);
        let first_again = control.try_admit("attachment-1").unwrap();
        assert_eq!(control.active.load(Ordering::Acquire), 2);

        drop(first_again);
        drop(second);
        assert_eq!(control.active.load(Ordering::Acquire), 0);
        assert!(control.active_attachment_ids.lock().unwrap().is_empty());
    }

    #[test]
    fn declared_memory_bound_matches_two_chunks_plus_overhead() {
        assert_eq!(
            AttachmentTransferWorker::memory_bound(1024 * 1024),
            18 * 1024 * 1024
        );
    }
}
