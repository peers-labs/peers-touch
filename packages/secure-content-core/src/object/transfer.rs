use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use crate::ports::{
    ObjectBlob, ObjectCommitmentCodec, ObjectTransferRepository, ObjectTransferTransport,
};

use super::crypto::expected_plaintext_chunk_size;
use super::{
    decrypt_object_chunk, encrypt_object_chunk, validate_object_descriptor, EncryptedObjectChunk,
    ObjectCryptoMaterial, ObjectDescriptor, ObjectEncryptionSuite, ObjectNonceStrategy,
    ObjectUploadSpec, OBJECT_CHUNK_SIZE, OBJECT_MAX_PLAINTEXT_SIZE, OBJECT_TAG_SIZE,
};

pub const OBJECT_TRANSFER_MEMORY_OVERHEAD: usize = 16 * 1024 * 1024;
const OBJECT_MAX_ACTIVE_TRANSFERS: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum ObjectTransferDirection {
    Upload = 1,
    Download = 2,
}

impl TryFrom<i32> for ObjectTransferDirection {
    type Error = String;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::Upload),
            2 => Ok(Self::Download),
            _ => Err("secure content object transfer direction is invalid".to_string()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum ObjectTransferState {
    Queued = 1,
    Transferring = 2,
    Verifying = 3,
    Complete = 4,
    RetryWait = 5,
    Cancelled = 6,
    Terminal = 7,
}

impl TryFrom<i32> for ObjectTransferState {
    type Error = String;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::Queued),
            2 => Ok(Self::Transferring),
            3 => Ok(Self::Verifying),
            4 => Ok(Self::Complete),
            5 => Ok(Self::RetryWait),
            6 => Ok(Self::Cancelled),
            7 => Ok(Self::Terminal),
            _ => Err("secure content object transfer state is invalid".to_string()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum ObjectTransferErrorCode {
    UploadExpired = 1,
    PartConflict = 2,
    RangeInvalid = 3,
    DescriptorMismatch = 4,
    IntegrityFailed = 5,
    NotGranted = 6,
    QuotaExceeded = 7,
    RetryLater = 8,
}

impl ObjectTransferErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UploadExpired => "UPLOAD_EXPIRED",
            Self::PartConflict => "PART_CONFLICT",
            Self::RangeInvalid => "RANGE_INVALID",
            Self::DescriptorMismatch => "DESCRIPTOR_MISMATCH",
            Self::IntegrityFailed => "INTEGRITY_FAILED",
            Self::NotGranted => "NOT_GRANTED",
            Self::QuotaExceeded => "QUOTA_EXCEEDED",
            Self::RetryLater => "RETRY_LATER",
        }
    }
}

impl TryFrom<i32> for ObjectTransferErrorCode {
    type Error = String;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::UploadExpired),
            2 => Ok(Self::PartConflict),
            3 => Ok(Self::RangeInvalid),
            4 => Ok(Self::DescriptorMismatch),
            5 => Ok(Self::IntegrityFailed),
            6 => Ok(Self::NotGranted),
            7 => Ok(Self::QuotaExceeded),
            8 => Ok(Self::RetryLater),
            _ => Err("secure content object transfer error code is invalid".to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectTransferFailure {
    pub code: ObjectTransferErrorCode,
    pub retry_after_ms: Option<i64>,
    pub retryable: bool,
    pub detail: String,
}

impl ObjectTransferFailure {
    pub fn retryable(
        code: ObjectTransferErrorCode,
        retry_after_ms: Option<i64>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            code,
            retry_after_ms,
            retryable: true,
            detail: detail.into(),
        }
    }

    pub fn terminal(code: ObjectTransferErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            retry_after_ms: None,
            retryable: false,
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for ObjectTransferFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code.as_str(), self.detail)
    }
}

impl std::error::Error for ObjectTransferFailure {}

impl From<String> for ObjectTransferFailure {
    fn from(detail: String) -> Self {
        Self::retryable(ObjectTransferErrorCode::RetryLater, None, detail)
    }
}

fn integrity_failure(detail: impl Into<String>) -> ObjectTransferFailure {
    ObjectTransferFailure::terminal(ObjectTransferErrorCode::IntegrityFailed, detail)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ObjectRetryPolicy {
    pub initial_delay_ms: i64,
    pub maximum_delay_ms: i64,
}

impl Default for ObjectRetryPolicy {
    fn default() -> Self {
        Self {
            initial_delay_ms: 1_000,
            maximum_delay_ms: 300_000,
        }
    }
}

impl ObjectRetryPolicy {
    fn validate(self) -> Result<Self, String> {
        if self.initial_delay_ms <= 0 || self.maximum_delay_ms < self.initial_delay_ms {
            return Err("secure content object retry policy is invalid".to_string());
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ObjectTransferProgress {
    Complete,
    Deferred { next_attempt_at_unix_ms: i64 },
    RetryScheduled { next_attempt_at_unix_ms: i64 },
    Terminal { code: ObjectTransferErrorCode },
}

pub struct ObjectTransferControl {
    shutdown: AtomicBool,
    active: AtomicUsize,
    active_transfer_ids: Mutex<HashSet<String>>,
    idle: Condvar,
}

#[derive(Debug)]
enum AdmissionError {
    AlreadyActive,
    Failure(ObjectTransferFailure),
}

#[derive(Debug)]
enum DownloadAttemptError {
    BeforeCompletion(ObjectTransferFailure),
    Finalization(ObjectTransferFailure),
}

impl From<ObjectTransferFailure> for DownloadAttemptError {
    fn from(failure: ObjectTransferFailure) -> Self {
        Self::BeforeCompletion(failure)
    }
}

impl ObjectTransferControl {
    pub fn new() -> Self {
        Self {
            shutdown: AtomicBool::new(false),
            active: AtomicUsize::new(0),
            active_transfer_ids: Mutex::new(HashSet::new()),
            idle: Condvar::new(),
        }
    }

    pub fn request_shutdown(&self) {
        self.shutdown.store(true, Ordering::Release);
    }

    pub fn request_shutdown_and_wait(&self, timeout: Duration) -> bool {
        self.request_shutdown();
        let deadline = Instant::now() + timeout;
        let mut active_transfer_ids = match self.active_transfer_ids.lock() {
            Ok(active_transfer_ids) => active_transfer_ids,
            Err(_) => return false,
        };
        while self.active.load(Ordering::Acquire) != 0 {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let remaining = deadline.saturating_duration_since(now);
            match self.idle.wait_timeout(active_transfer_ids, remaining) {
                Ok((guard, result)) => {
                    active_transfer_ids = guard;
                    if result.timed_out() && self.active.load(Ordering::Acquire) != 0 {
                        return false;
                    }
                }
                Err(_) => return false,
            }
        }
        true
    }

    fn check_running(&self) -> Result<(), ObjectTransferFailure> {
        if self.shutdown.load(Ordering::Acquire) {
            return Err(ObjectTransferFailure::retryable(
                ObjectTransferErrorCode::RetryLater,
                None,
                "secure content object transfer is shutting down",
            ));
        }
        Ok(())
    }

    fn try_admit(&self, transfer_id: &str) -> Result<ObjectTransferPermit<'_>, AdmissionError> {
        self.check_running().map_err(AdmissionError::Failure)?;
        let mut active_transfer_ids = self.active_transfer_ids.lock().map_err(|_| {
            AdmissionError::Failure(ObjectTransferFailure::retryable(
                ObjectTransferErrorCode::RetryLater,
                None,
                "secure content object transfer admission lock is poisoned",
            ))
        })?;
        if active_transfer_ids.contains(transfer_id) {
            return Err(AdmissionError::AlreadyActive);
        }
        let admitted = self
            .active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < OBJECT_MAX_ACTIVE_TRANSFERS).then_some(active + 1)
            })
            .is_ok();
        if !admitted {
            return Err(AdmissionError::Failure(ObjectTransferFailure::retryable(
                ObjectTransferErrorCode::RetryLater,
                None,
                "secure content object transfer admission is full",
            )));
        }
        active_transfer_ids.insert(transfer_id.to_string());
        Ok(ObjectTransferPermit {
            control: self,
            transfer_id: transfer_id.to_string(),
        })
    }
}

impl Default for ObjectTransferControl {
    fn default() -> Self {
        Self::new()
    }
}

struct ObjectTransferPermit<'a> {
    control: &'a ObjectTransferControl,
    transfer_id: String,
}

impl Drop for ObjectTransferPermit<'_> {
    fn drop(&mut self) {
        if let Ok(mut active_transfer_ids) = self.control.active_transfer_ids.lock() {
            active_transfer_ids.remove(&self.transfer_id);
        }
        if self.control.active.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.control.idle.notify_all();
        }
    }
}

#[derive(Debug, Clone)]
pub struct PreparedObjectUpload {
    pub object: ObjectUploadSpec,
    pub descriptor_sha256: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectTransferRecord {
    pub transfer_id: String,
    pub owner_scope_id: String,
    pub operation_id: String,
    pub authority_id: String,
    pub direction: ObjectTransferDirection,
    pub state: ObjectTransferState,
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
    pub last_error: Option<ObjectTransferErrorCode>,
    pub updated_at_unix_ms: i64,
}

pub fn validate_object_transfer_record(transfer: &ObjectTransferRecord) -> Result<(), String> {
    if transfer.transfer_id.trim().is_empty()
        || transfer.owner_scope_id.trim().is_empty()
        || transfer.operation_id.trim().is_empty()
        || transfer.authority_id.trim().is_empty()
        || transfer.descriptor_sha256.len() != 32
        || transfer.completed_chunk_bitmap.is_empty()
        || (transfer.source_local_ref.trim().is_empty()
            && transfer.partial_local_ref.trim().is_empty())
        || transfer.object_key.len() != 32
        || transfer.base_nonce.len() != 12
        || transfer.base_nonce[8..] != [0, 0, 0, 0]
        || transfer.plaintext_size == 0
        || transfer.plaintext_size > OBJECT_MAX_PLAINTEXT_SIZE
        || transfer.chunk_size == 0
        || transfer.chunk_size > OBJECT_CHUNK_SIZE
        || transfer.next_attempt_at_unix_ms < 0
        || transfer.updated_at_unix_ms <= 0
    {
        return Err("secure content object transfer is incomplete".to_string());
    }
    validate_bitmap(
        &transfer.completed_chunk_bitmap,
        transfer
            .plaintext_size
            .div_ceil(u64::from(transfer.chunk_size)) as u32,
    )
}

pub struct ObjectTransferWorker {
    store: Arc<dyn ObjectTransferRepository>,
    transport: Arc<dyn ObjectTransferTransport>,
    blobs: Arc<dyn ObjectBlob>,
    commitments: Arc<dyn ObjectCommitmentCodec>,
    control: Arc<ObjectTransferControl>,
    retry_policy: ObjectRetryPolicy,
}

impl ObjectTransferWorker {
    pub fn new(
        store: Arc<dyn ObjectTransferRepository>,
        transport: Arc<dyn ObjectTransferTransport>,
        blobs: Arc<dyn ObjectBlob>,
        commitments: Arc<dyn ObjectCommitmentCodec>,
    ) -> Self {
        Self::with_control(
            store,
            transport,
            blobs,
            commitments,
            Arc::new(ObjectTransferControl::new()),
            ObjectRetryPolicy::default(),
        )
        .expect("default secure content transfer policy must be valid")
    }

    pub fn with_control(
        store: Arc<dyn ObjectTransferRepository>,
        transport: Arc<dyn ObjectTransferTransport>,
        blobs: Arc<dyn ObjectBlob>,
        commitments: Arc<dyn ObjectCommitmentCodec>,
        control: Arc<ObjectTransferControl>,
        retry_policy: ObjectRetryPolicy,
    ) -> Result<Self, String> {
        Ok(Self {
            store,
            transport,
            blobs,
            commitments,
            control,
            retry_policy: retry_policy.validate()?,
        })
    }

    pub fn memory_bound(chunk_size: u32) -> usize {
        2 * chunk_size as usize + OBJECT_TRANSFER_MEMORY_OVERHEAD
    }

    pub fn run_upload_once(
        &self,
        transfer_id: &str,
        now_unix_ms: i64,
    ) -> Result<ObjectTransferProgress, ObjectTransferFailure> {
        if let Some(progress) = self.preflight(transfer_id, now_unix_ms)? {
            return Ok(progress);
        }
        let _permit = match self.control.try_admit(transfer_id) {
            Ok(permit) => permit,
            Err(AdmissionError::AlreadyActive) => {
                return Ok(ObjectTransferProgress::Deferred {
                    next_attempt_at_unix_ms: now_unix_ms,
                })
            }
            Err(AdmissionError::Failure(failure)) => {
                return self.persist_failure(transfer_id, now_unix_ms, failure)
            }
        };
        match self.upload_once(transfer_id, now_unix_ms) {
            Ok(true) => Ok(ObjectTransferProgress::Complete),
            Ok(false) => Err(integrity_failure(
                "secure content object upload made no progress",
            )),
            Err(failure) => self.persist_failure(transfer_id, now_unix_ms, failure),
        }
    }

    pub fn run_download_once(
        &self,
        transfer_id: &str,
        descriptor: &ObjectDescriptor,
        expected_plaintext_sha256: &[u8; 32],
        cache_ref: &str,
        now_unix_ms: i64,
    ) -> Result<ObjectTransferProgress, ObjectTransferFailure> {
        let existing = self.required_transfer(transfer_id)?;
        if existing.state == ObjectTransferState::Complete {
            let plaintext_staging_ref = plaintext_staging_ref(cache_ref);
            let validation = (|| -> Result<(), ObjectTransferFailure> {
                if existing.partial_local_ref == cache_ref
                    || existing.partial_local_ref == plaintext_staging_ref
                {
                    return Err(integrity_failure(
                        "secure content download artifact paths overlap",
                    ));
                }
                let (_, descriptor_hash) =
                    self.validate_download_descriptor(&existing, descriptor)?;
                if existing.descriptor_sha256 != descriptor_hash {
                    return Err(ObjectTransferFailure::terminal(
                        ObjectTransferErrorCode::DescriptorMismatch,
                        "secure content completed object descriptor commitment changed",
                    ));
                }
                self.finalize_completed_download_artifacts(
                    cache_ref,
                    &plaintext_staging_ref,
                    &existing.partial_local_ref,
                    expected_plaintext_sha256,
                )
            })();
            if let Err(failure) = validation {
                if failure.retryable {
                    return Err(failure);
                }
                return Err(self.cleanup_download_failure(
                    failure,
                    cache_ref,
                    &plaintext_staging_ref,
                    &existing.partial_local_ref,
                ));
            }
            return Ok(ObjectTransferProgress::Complete);
        }
        if let Some(progress) = self.preflight(transfer_id, now_unix_ms)? {
            return Ok(progress);
        }
        let _permit = match self.control.try_admit(transfer_id) {
            Ok(permit) => permit,
            Err(AdmissionError::AlreadyActive) => {
                return Ok(ObjectTransferProgress::Deferred {
                    next_attempt_at_unix_ms: now_unix_ms,
                })
            }
            Err(AdmissionError::Failure(failure)) => {
                let failure = self.cleanup_download_failure(
                    failure,
                    cache_ref,
                    &plaintext_staging_ref(cache_ref),
                    &existing.partial_local_ref,
                );
                return self.persist_failure(transfer_id, now_unix_ms, failure);
            }
        };
        match self.download_once(
            transfer_id,
            descriptor,
            expected_plaintext_sha256,
            cache_ref,
            now_unix_ms,
        ) {
            Ok(true) => Ok(ObjectTransferProgress::Complete),
            Ok(false) => Err(integrity_failure(
                "secure content object download made no progress",
            )),
            Err(DownloadAttemptError::BeforeCompletion(failure)) => {
                self.persist_failure(transfer_id, now_unix_ms, failure)
            }
            Err(DownloadAttemptError::Finalization(failure)) => Err(failure),
        }
    }

    fn upload_once(
        &self,
        transfer_id: &str,
        now_unix_ms: i64,
    ) -> Result<bool, ObjectTransferFailure> {
        self.control.check_running()?;
        let mut transfer = self.required_transfer(transfer_id)?;
        let material = material_from_transfer(&transfer).map_err(integrity_failure)?;
        let media_type = self.store.upload_media_type(transfer_id)?;
        let prepared = prepare_upload(
            self.blobs.as_ref(),
            &transfer.source_local_ref,
            &material,
            &transfer,
            media_type,
            self.commitments.as_ref(),
        )
        .map_err(integrity_failure)?;
        self.store.update_transfer_prepared(
            transfer_id,
            &prepared.descriptor_sha256,
            &transfer.partial_local_ref,
            now_unix_ms,
        )?;
        transfer = self.required_transfer(transfer_id)?;
        if transfer.upload_id.is_empty() {
            let (upload_id, generation, bitmap) =
                self.transport.begin_upload(&transfer, &prepared)?;
            validate_bitmap(&bitmap, material.chunk_count()).map_err(integrity_failure)?;
            self.store.update_transfer_progress(
                transfer_id,
                ObjectTransferState::Transferring,
                &upload_id,
                generation,
                &bitmap,
                transfer.attempt_count,
                0,
                None,
                now_unix_ms,
            )?;
            transfer = self.required_transfer(transfer_id)?;
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
            let encrypted = encrypt_object_chunk(&material, chunk_index, &plaintext)
                .map_err(integrity_failure)?;
            if encrypted.ciphertext_sha256
                != prepared.object.chunk_ciphertext_sha256[chunk_index as usize].as_slice()
            {
                return Err(integrity_failure(
                    "secure content prepared object chunk changed",
                ));
            }
            self.transport.put_upload_chunk(&transfer, &encrypted)?;
            set_chunk_complete(&mut transfer.completed_chunk_bitmap, chunk_index);
            self.store.update_transfer_progress(
                transfer_id,
                ObjectTransferState::Transferring,
                &transfer.upload_id,
                transfer.generation,
                &transfer.completed_chunk_bitmap,
                transfer.attempt_count,
                0,
                None,
                now_unix_ms,
            )?;
        }
        let descriptor = self.transport.complete_upload(&transfer, &prepared)?;
        validate_object_descriptor(&descriptor).map_err(integrity_failure)?;
        if descriptor.commitment.ciphertext_sha256 != prepared.object.ciphertext_sha256 {
            return Err(integrity_failure(
                "secure content object completion hash mismatch",
            ));
        }
        self.store
            .complete_upload(&transfer, &descriptor, now_unix_ms)?;
        Ok(true)
    }

    fn download_once(
        &self,
        transfer_id: &str,
        descriptor: &ObjectDescriptor,
        expected_plaintext_sha256: &[u8; 32],
        cache_ref: &str,
        now_unix_ms: i64,
    ) -> Result<bool, DownloadAttemptError> {
        let mut transfer = self.required_transfer(transfer_id)?;
        let plaintext_staging_ref = plaintext_staging_ref(cache_ref);
        if transfer.partial_local_ref == cache_ref
            || transfer.partial_local_ref == plaintext_staging_ref
        {
            let failure = integrity_failure("secure content download artifact paths overlap");
            return Err(DownloadAttemptError::BeforeCompletion(
                self.cleanup_download_failure(
                    failure,
                    cache_ref,
                    &plaintext_staging_ref,
                    &transfer.partial_local_ref,
                ),
            ));
        }
        if let Err(failure) = self.control.check_running() {
            return Err(DownloadAttemptError::BeforeCompletion(
                self.cleanup_download_failure(
                    failure,
                    cache_ref,
                    &plaintext_staging_ref,
                    &transfer.partial_local_ref,
                ),
            ));
        }
        let materialization = (|| -> Result<bool, ObjectTransferFailure> {
            let (material, descriptor_hash) =
                self.validate_download_descriptor(&transfer, descriptor)?;
            self.store.update_transfer_prepared(
                transfer_id,
                &descriptor_hash,
                &transfer.partial_local_ref,
                now_unix_ms,
            )?;
            transfer = self.required_transfer(transfer_id)?;
            validate_bitmap(
                &transfer.completed_chunk_bitmap,
                descriptor.commitment.chunk_count,
            )
            .map_err(integrity_failure)?;
            if self.blobs.exists(cache_ref)? {
                if (0..descriptor.commitment.chunk_count)
                    .all(|index| chunk_complete(&transfer.completed_chunk_bitmap, index))
                    && self.blobs.sha256(cache_ref)? == *expected_plaintext_sha256
                {
                    self.blobs.remove(&plaintext_staging_ref)?;
                    return Ok(true);
                }
                self.blobs.remove(cache_ref)?;
            }
            self.blobs.remove(&plaintext_staging_ref)?;
            validate_partial_ciphertext(self.blobs.as_ref(), &transfer, &material, descriptor)
                .map_err(integrity_failure)?;

            for chunk_index in 0..descriptor.commitment.chunk_count {
                self.control.check_running()?;
                if chunk_complete(&transfer.completed_chunk_bitmap, chunk_index) {
                    continue;
                }
                let ciphertext_size = expected_ciphertext_chunk_size(&material, chunk_index)?;
                let start = ciphertext_chunk_offset(&material, chunk_index);
                let ciphertext = self.transport.get_download_chunk(
                    &transfer,
                    descriptor,
                    chunk_index,
                    start,
                    start + ciphertext_size as u64 - 1,
                )?;
                if ciphertext.len() != ciphertext_size {
                    return Err(integrity_failure(
                        "secure content downloaded chunk size mismatch",
                    ));
                }
                if descriptor.commitment.chunk_ciphertext_sha256[chunk_index as usize]
                    != Sha256::digest(&ciphertext).as_slice()
                {
                    return Err(integrity_failure(
                        "secure content downloaded chunk hash mismatch",
                    ));
                }
                self.blobs
                    .write_chunk(&transfer.partial_local_ref, start, &ciphertext)?;
                set_chunk_complete(&mut transfer.completed_chunk_bitmap, chunk_index);
                self.store.update_transfer_progress(
                    transfer_id,
                    ObjectTransferState::Transferring,
                    &transfer.upload_id,
                    transfer.generation,
                    &transfer.completed_chunk_bitmap,
                    transfer.attempt_count,
                    0,
                    None,
                    now_unix_ms,
                )?;
            }
            self.blobs.truncate(
                &transfer.partial_local_ref,
                descriptor.commitment.ciphertext_size,
            )?;
            let expected_ciphertext_sha256: [u8; 32] = descriptor
                .commitment
                .ciphertext_sha256
                .as_slice()
                .try_into()
                .map_err(|_| {
                    integrity_failure("secure content object ciphertext commitment is invalid")
                })?;
            if self.blobs.sha256(&transfer.partial_local_ref)? != expected_ciphertext_sha256 {
                return Err(integrity_failure(
                    "secure content object ciphertext hash mismatch",
                ));
            }
            for chunk_index in 0..descriptor.commitment.chunk_count {
                self.control.check_running()?;
                let expected_hash: [u8; 32] = descriptor.commitment.chunk_ciphertext_sha256
                    [chunk_index as usize]
                    .as_slice()
                    .try_into()
                    .map_err(|_| {
                        integrity_failure("secure content object chunk commitment is invalid")
                    })?;
                let ciphertext = self.blobs.read_chunk(
                    &transfer.partial_local_ref,
                    ciphertext_chunk_offset(&material, chunk_index),
                    expected_ciphertext_chunk_size(&material, chunk_index)?,
                )?;
                let plaintext = decrypt_object_chunk(
                    &material,
                    &EncryptedObjectChunk {
                        chunk_index,
                        ciphertext,
                        ciphertext_sha256: expected_hash,
                    },
                )
                .map_err(integrity_failure)?;
                self.blobs.write_chunk(
                    &plaintext_staging_ref,
                    u64::from(chunk_index) * u64::from(material.chunk_size()),
                    &plaintext,
                )?;
            }
            self.blobs
                .truncate(&plaintext_staging_ref, material.plaintext_size())?;
            if self.blobs.sha256(&plaintext_staging_ref)? != *expected_plaintext_sha256 {
                return Err(integrity_failure(
                    "secure content object plaintext hash mismatch",
                ));
            }
            Ok(false)
        })();
        match materialization {
            Ok(_) => {}
            Err(failure) => {
                return Err(DownloadAttemptError::BeforeCompletion(
                    self.cleanup_download_failure(
                        failure,
                        cache_ref,
                        &plaintext_staging_ref,
                        &transfer.partial_local_ref,
                    ),
                ))
            }
        };
        if let Err(failure) =
            self.store
                .complete_download(&transfer, descriptor, cache_ref, now_unix_ms)
        {
            return Err(DownloadAttemptError::Finalization(
                self.cleanup_download_failure(
                    failure,
                    cache_ref,
                    &plaintext_staging_ref,
                    &transfer.partial_local_ref,
                ),
            ));
        }
        self.finalize_completed_download_artifacts(
            cache_ref,
            &plaintext_staging_ref,
            &transfer.partial_local_ref,
            expected_plaintext_sha256,
        )
        .map_err(DownloadAttemptError::Finalization)?;
        Ok(true)
    }

    pub fn cancel(&self, transfer_id: &str, now_unix_ms: i64) -> Result<(), ObjectTransferFailure> {
        let transfer = self.required_transfer(transfer_id)?;
        if transfer.state == ObjectTransferState::Complete
            && transfer.direction == ObjectTransferDirection::Download
        {
            return Err(ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::DescriptorMismatch,
                "secure content completed download cannot be cancelled",
            ));
        }
        if transfer.state == ObjectTransferState::Cancelled {
            return Ok(());
        }
        if !transfer.upload_id.is_empty() {
            self.transport.cancel_upload(&transfer)?;
        }
        self.blobs.remove(&transfer.partial_local_ref)?;
        self.store.update_transfer_progress(
            transfer_id,
            ObjectTransferState::Cancelled,
            &transfer.upload_id,
            transfer.generation,
            &transfer.completed_chunk_bitmap,
            transfer.attempt_count,
            0,
            None,
            now_unix_ms,
        )
    }

    fn required_transfer(
        &self,
        transfer_id: &str,
    ) -> Result<ObjectTransferRecord, ObjectTransferFailure> {
        self.store.object_transfer(transfer_id)?.ok_or_else(|| {
            ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::DescriptorMismatch,
                "secure content object transfer is unavailable",
            )
        })
    }

    fn validate_download_descriptor(
        &self,
        transfer: &ObjectTransferRecord,
        descriptor: &ObjectDescriptor,
    ) -> Result<(ObjectCryptoMaterial, [u8; 32]), ObjectTransferFailure> {
        validate_object_descriptor(descriptor).map_err(integrity_failure)?;
        let material = material_from_transfer(transfer).map_err(integrity_failure)?;
        let expected_ciphertext_size = material
            .plaintext_size()
            .saturating_add(u64::from(material.chunk_count()) * u64::from(OBJECT_TAG_SIZE));
        if descriptor.commitment.chunk_count != material.chunk_count()
            || descriptor.commitment.chunk_size != material.chunk_size()
            || descriptor.commitment.ciphertext_size != expected_ciphertext_size
        {
            return Err(integrity_failure(
                "secure content object descriptor/material mismatch",
            ));
        }
        let descriptor_hash = self.commitments.descriptor_commitment(descriptor)?;
        if transfer.descriptor_sha256 != vec![0; 32]
            && transfer.descriptor_sha256 != descriptor_hash
        {
            return Err(ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::DescriptorMismatch,
                "secure content object descriptor commitment changed",
            ));
        }
        Ok((material, descriptor_hash))
    }

    fn cleanup_download_failure(
        &self,
        failure: ObjectTransferFailure,
        cache_ref: &str,
        plaintext_staging_ref: &str,
        partial_local_ref: &str,
    ) -> ObjectTransferFailure {
        let mut cleanup_failed = false;
        for artifact_ref in [cache_ref, plaintext_staging_ref] {
            if self.blobs.remove(artifact_ref).is_err() {
                cleanup_failed = true;
            }
        }
        if !failure.retryable && self.blobs.remove(partial_local_ref).is_err() {
            cleanup_failed = true;
        }
        if cleanup_failed {
            return integrity_failure("secure content object failure cleanup failed");
        }
        failure
    }

    fn finalize_completed_download_artifacts(
        &self,
        cache_ref: &str,
        plaintext_staging_ref: &str,
        partial_local_ref: &str,
        expected_plaintext_sha256: &[u8; 32],
    ) -> Result<(), ObjectTransferFailure> {
        let cache_is_valid = self.blobs.exists(cache_ref)?
            && self.blobs.sha256(cache_ref)? == *expected_plaintext_sha256;
        if !cache_is_valid {
            self.blobs.remove(cache_ref)?;
            if !self.blobs.exists(plaintext_staging_ref)?
                || self.blobs.sha256(plaintext_staging_ref)? != *expected_plaintext_sha256
            {
                return Err(self.cleanup_download_failure(
                    integrity_failure(
                        "secure content completed object has no verified plaintext artifact",
                    ),
                    cache_ref,
                    plaintext_staging_ref,
                    partial_local_ref,
                ));
            }
            self.blobs
                .promote(plaintext_staging_ref, cache_ref)
                .map_err(ObjectTransferFailure::from)?;
            if !self.blobs.exists(cache_ref)?
                || self.blobs.sha256(cache_ref)? != *expected_plaintext_sha256
            {
                return Err(self.cleanup_download_failure(
                    integrity_failure("secure content promoted object cache is invalid"),
                    cache_ref,
                    plaintext_staging_ref,
                    partial_local_ref,
                ));
            }
        }
        self.blobs.remove(plaintext_staging_ref)?;
        self.blobs.remove(partial_local_ref)?;
        Ok(())
    }

    fn preflight(
        &self,
        transfer_id: &str,
        now_unix_ms: i64,
    ) -> Result<Option<ObjectTransferProgress>, ObjectTransferFailure> {
        let transfer = self.required_transfer(transfer_id)?;
        if transfer.state == ObjectTransferState::Complete {
            return Ok(Some(ObjectTransferProgress::Complete));
        }
        if matches!(
            transfer.state,
            ObjectTransferState::Cancelled | ObjectTransferState::Terminal
        ) {
            return Err(ObjectTransferFailure::terminal(
                transfer
                    .last_error
                    .unwrap_or(ObjectTransferErrorCode::DescriptorMismatch),
                "secure content object transfer is terminal",
            ));
        }
        if transfer.state == ObjectTransferState::RetryWait
            && transfer.next_attempt_at_unix_ms > now_unix_ms
        {
            return Ok(Some(ObjectTransferProgress::Deferred {
                next_attempt_at_unix_ms: transfer.next_attempt_at_unix_ms,
            }));
        }
        Ok(None)
    }

    fn persist_failure(
        &self,
        transfer_id: &str,
        now_unix_ms: i64,
        failure: ObjectTransferFailure,
    ) -> Result<ObjectTransferProgress, ObjectTransferFailure> {
        let transfer = self.required_transfer(transfer_id)?;
        if transfer.state == ObjectTransferState::Complete {
            return Ok(ObjectTransferProgress::Complete);
        }
        let attempt_count = transfer.attempt_count.saturating_add(1);
        if failure.retryable {
            let policy_delay = retry_delay_ms(
                transfer_id,
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
            self.store.update_transfer_progress(
                transfer_id,
                ObjectTransferState::RetryWait,
                &transfer.upload_id,
                transfer.generation,
                &transfer.completed_chunk_bitmap,
                attempt_count,
                next_attempt_at_unix_ms,
                Some(failure.code),
                now_unix_ms,
            )?;
            return Ok(ObjectTransferProgress::RetryScheduled {
                next_attempt_at_unix_ms,
            });
        }
        self.store.update_transfer_progress(
            transfer_id,
            ObjectTransferState::Terminal,
            &transfer.upload_id,
            transfer.generation,
            &transfer.completed_chunk_bitmap,
            attempt_count,
            0,
            Some(failure.code),
            now_unix_ms,
        )?;
        Ok(ObjectTransferProgress::Terminal { code: failure.code })
    }
}

fn retry_delay_ms(
    transfer_id: &str,
    attempt_count: u32,
    initial_delay_ms: i64,
    maximum_delay_ms: i64,
) -> i64 {
    let exponent = attempt_count.saturating_sub(1).min(30);
    let base = initial_delay_ms
        .saturating_mul(1_i64 << exponent)
        .min(maximum_delay_ms);
    let mut hash = Sha256::new();
    hash.update(transfer_id.as_bytes());
    hash.update(attempt_count.to_be_bytes());
    let digest = hash.finalize();
    let jitter_percent = 75 + i64::from(digest[0] % 51);
    base.saturating_mul(jitter_percent)
        .saturating_div(100)
        .min(maximum_delay_ms)
}

fn prepare_upload(
    blobs: &dyn ObjectBlob,
    source_ref: &str,
    material: &ObjectCryptoMaterial,
    transfer: &ObjectTransferRecord,
    media_type: Option<String>,
    commitments: &dyn ObjectCommitmentCodec,
) -> Result<PreparedObjectUpload, String> {
    if blobs.len(source_ref)? != material.plaintext_size() {
        return Err("secure content object source size changed".to_string());
    }
    let mut whole = Sha256::new();
    let mut chunk_hashes = Vec::with_capacity(material.chunk_count() as usize);
    let mut ciphertext_size = 0_u64;
    for chunk_index in 0..material.chunk_count() {
        let plaintext = read_plaintext_chunk(blobs, source_ref, material, chunk_index)?;
        let encrypted = encrypt_object_chunk(material, chunk_index, &plaintext)?;
        whole.update(&encrypted.ciphertext);
        ciphertext_size += encrypted.ciphertext.len() as u64;
        chunk_hashes.push(encrypted.ciphertext_sha256.to_vec());
    }
    let object = ObjectUploadSpec {
        ciphertext_size,
        ciphertext_sha256: whole.finalize().to_vec(),
        media_type,
        chunk_size: material.chunk_size(),
        chunk_count: material.chunk_count(),
        encryption_suite: ObjectEncryptionSuite::Aes256GcmChunked,
        tag_size: OBJECT_TAG_SIZE,
        nonce_strategy: ObjectNonceStrategy::Counter32Be,
        chunk_ciphertext_sha256: chunk_hashes,
    };
    let descriptor_sha256 = commitments
        .upload_commitment(transfer, &object)
        .map_err(|failure| failure.to_string())?;
    Ok(PreparedObjectUpload {
        object,
        descriptor_sha256,
    })
}

fn material_from_transfer(transfer: &ObjectTransferRecord) -> Result<ObjectCryptoMaterial, String> {
    ObjectCryptoMaterial::from_parts(
        transfer
            .object_key
            .as_slice()
            .try_into()
            .map_err(|_| "secure content object key is invalid")?,
        transfer
            .base_nonce
            .as_slice()
            .try_into()
            .map_err(|_| "secure content object base nonce is invalid")?,
        transfer.plaintext_size,
        transfer.chunk_size,
    )
}

fn read_plaintext_chunk(
    blobs: &dyn ObjectBlob,
    blob_ref: &str,
    material: &ObjectCryptoMaterial,
    index: u32,
) -> Result<Vec<u8>, String> {
    let size = expected_plaintext_chunk_size(material, index)?;
    blobs.read_chunk(
        blob_ref,
        u64::from(index) * u64::from(material.chunk_size()),
        size,
    )
}

fn validate_bitmap(bitmap: &[u8], chunks: u32) -> Result<(), String> {
    if bitmap.len() != chunks.div_ceil(8) as usize {
        return Err("secure content object checkpoint bitmap mismatch".to_string());
    }
    if chunks % 8 != 0 {
        let used_bits = chunks % 8;
        let unused_mask = !((1_u8 << used_bits) - 1);
        if bitmap.last().is_some_and(|byte| byte & unused_mask != 0) {
            return Err("secure content object checkpoint bitmap is invalid".to_string());
        }
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

fn ciphertext_chunk_offset(material: &ObjectCryptoMaterial, index: u32) -> u64 {
    u64::from(index) * u64::from(material.chunk_size() + OBJECT_TAG_SIZE)
}

fn expected_ciphertext_chunk_size(
    material: &ObjectCryptoMaterial,
    index: u32,
) -> Result<usize, String> {
    expected_plaintext_chunk_size(material, index).map(|size| size + OBJECT_TAG_SIZE as usize)
}

fn plaintext_staging_ref(cache_ref: &str) -> String {
    format!("{cache_ref}.decrypting")
}

fn validate_partial_ciphertext(
    blobs: &dyn ObjectBlob,
    transfer: &ObjectTransferRecord,
    material: &ObjectCryptoMaterial,
    descriptor: &ObjectDescriptor,
) -> Result<(), String> {
    if !blobs.exists(&transfer.partial_local_ref)? {
        if transfer
            .completed_chunk_bitmap
            .iter()
            .any(|byte| *byte != 0)
        {
            return Err("secure content partial object is missing".to_string());
        }
        return Ok(());
    }
    let mut completed_prefix = 0;
    let mut found_gap = false;
    for chunk_index in 0..material.chunk_count() {
        if chunk_complete(&transfer.completed_chunk_bitmap, chunk_index) {
            if found_gap {
                return Err(
                    "secure content partial object checkpoint is non-contiguous".to_string()
                );
            }
            completed_prefix += 1;
        } else {
            found_gap = true;
        }
    }
    let expected_length = if completed_prefix == 0 {
        0
    } else {
        let last_index = completed_prefix - 1;
        ciphertext_chunk_offset(material, last_index)
            + expected_ciphertext_chunk_size(material, last_index)? as u64
    };
    let actual_length = blobs.len(&transfer.partial_local_ref)?;
    if actual_length < expected_length {
        return Err("secure content partial object checkpoint mismatch".to_string());
    }
    if actual_length > expected_length {
        blobs.truncate(&transfer.partial_local_ref, expected_length)?;
    }
    for chunk_index in 0..completed_prefix {
        let ciphertext = blobs.read_chunk(
            &transfer.partial_local_ref,
            ciphertext_chunk_offset(material, chunk_index),
            expected_ciphertext_chunk_size(material, chunk_index)?,
        )?;
        if descriptor.commitment.chunk_ciphertext_sha256[chunk_index as usize]
            != Sha256::digest(&ciphertext).as_slice()
        {
            return Err("secure content partial object integrity mismatch".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[derive(Default)]
    struct MemoryBlob {
        blobs: Mutex<HashMap<String, Vec<u8>>>,
        reject_next_promotion: AtomicBool,
    }

    impl MemoryBlob {
        fn put(&self, blob_ref: &str, value: Vec<u8>) {
            self.blobs
                .lock()
                .unwrap()
                .insert(blob_ref.to_string(), value);
        }

        fn bytes(&self, blob_ref: &str) -> Option<Vec<u8>> {
            self.blobs.lock().unwrap().get(blob_ref).cloned()
        }

        fn reject_next_promotion(&self) {
            self.reject_next_promotion.store(true, Ordering::Release);
        }
    }

    impl ObjectBlob for MemoryBlob {
        fn exists(&self, blob_ref: &str) -> Result<bool, String> {
            Ok(self.blobs.lock().unwrap().contains_key(blob_ref))
        }

        fn len(&self, blob_ref: &str) -> Result<u64, String> {
            self.blobs
                .lock()
                .unwrap()
                .get(blob_ref)
                .map(|value| value.len() as u64)
                .ok_or_else(|| "test object is unavailable".to_string())
        }

        fn read_chunk(
            &self,
            blob_ref: &str,
            offset: u64,
            length: usize,
        ) -> Result<Vec<u8>, String> {
            let blobs = self.blobs.lock().unwrap();
            let value = blobs
                .get(blob_ref)
                .ok_or_else(|| "test object is unavailable".to_string())?;
            let start = offset as usize;
            let end = start + length;
            value
                .get(start..end)
                .map(ToOwned::to_owned)
                .ok_or_else(|| "test object range is invalid".to_string())
        }

        fn write_chunk(&self, blob_ref: &str, offset: u64, data: &[u8]) -> Result<(), String> {
            let start = offset as usize;
            let end = start + data.len();
            let mut blobs = self.blobs.lock().unwrap();
            let value = blobs.entry(blob_ref.to_string()).or_default();
            value.resize(value.len().max(end), 0);
            value[start..end].copy_from_slice(data);
            Ok(())
        }

        fn truncate(&self, blob_ref: &str, length: u64) -> Result<(), String> {
            self.blobs
                .lock()
                .unwrap()
                .entry(blob_ref.to_string())
                .or_default()
                .resize(length as usize, 0);
            Ok(())
        }

        fn sha256(&self, blob_ref: &str) -> Result<[u8; 32], String> {
            self.blobs
                .lock()
                .unwrap()
                .get(blob_ref)
                .map(|value| Sha256::digest(value).into())
                .ok_or_else(|| "test object is unavailable".to_string())
        }

        fn promote(&self, source_ref: &str, target_ref: &str) -> Result<(), String> {
            if self.reject_next_promotion.swap(false, Ordering::AcqRel) {
                return Err("test object promotion failed".to_string());
            }
            let mut blobs = self.blobs.lock().unwrap();
            let value = blobs
                .remove(source_ref)
                .ok_or_else(|| "test object is unavailable".to_string())?;
            blobs.insert(target_ref.to_string(), value);
            Ok(())
        }

        fn remove(&self, blob_ref: &str) -> Result<(), String> {
            self.blobs.lock().unwrap().remove(blob_ref);
            Ok(())
        }
    }

    #[derive(Default)]
    struct TestStore {
        records: Mutex<HashMap<String, ObjectTransferRecord>>,
        reject_download_completion: AtomicBool,
    }

    impl TestStore {
        fn insert(&self, transfer: ObjectTransferRecord) {
            self.records
                .lock()
                .unwrap()
                .insert(transfer.transfer_id.clone(), transfer);
        }

        fn record(&self, transfer_id: &str) -> ObjectTransferRecord {
            self.records.lock().unwrap()[transfer_id].clone()
        }
    }

    impl ObjectTransferRepository for TestStore {
        fn object_transfer(
            &self,
            transfer_id: &str,
        ) -> Result<Option<ObjectTransferRecord>, ObjectTransferFailure> {
            Ok(self.records.lock().unwrap().get(transfer_id).cloned())
        }

        fn upload_media_type(
            &self,
            _transfer_id: &str,
        ) -> Result<Option<String>, ObjectTransferFailure> {
            Ok(Some("application/octet-stream".to_string()))
        }

        fn update_transfer_prepared(
            &self,
            transfer_id: &str,
            descriptor_sha256: &[u8],
            partial_local_ref: &str,
            updated_at_unix_ms: i64,
        ) -> Result<(), ObjectTransferFailure> {
            let mut records = self.records.lock().unwrap();
            let record = records.get_mut(transfer_id).unwrap();
            if record.descriptor_sha256 != vec![0; 32]
                && record.descriptor_sha256 != descriptor_sha256
            {
                return Err(ObjectTransferFailure::terminal(
                    ObjectTransferErrorCode::DescriptorMismatch,
                    "test descriptor changed",
                ));
            }
            record.descriptor_sha256 = descriptor_sha256.to_vec();
            record.partial_local_ref = partial_local_ref.to_string();
            record.updated_at_unix_ms = updated_at_unix_ms;
            Ok(())
        }

        fn update_transfer_progress(
            &self,
            transfer_id: &str,
            state: ObjectTransferState,
            upload_id: &str,
            generation: u64,
            completed_chunk_bitmap: &[u8],
            attempt_count: u32,
            next_attempt_at_unix_ms: i64,
            last_error: Option<ObjectTransferErrorCode>,
            updated_at_unix_ms: i64,
        ) -> Result<(), ObjectTransferFailure> {
            let mut records = self.records.lock().unwrap();
            let record = records.get_mut(transfer_id).unwrap();
            record.state = state;
            record.upload_id = upload_id.to_string();
            record.generation = generation;
            record.completed_chunk_bitmap = completed_chunk_bitmap.to_vec();
            record.attempt_count = attempt_count;
            record.next_attempt_at_unix_ms = next_attempt_at_unix_ms;
            record.last_error = last_error;
            record.updated_at_unix_ms = updated_at_unix_ms;
            Ok(())
        }

        fn complete_upload(
            &self,
            transfer: &ObjectTransferRecord,
            _descriptor: &ObjectDescriptor,
            updated_at_unix_ms: i64,
        ) -> Result<(), ObjectTransferFailure> {
            self.update_transfer_progress(
                &transfer.transfer_id,
                ObjectTransferState::Complete,
                &transfer.upload_id,
                transfer.generation,
                &transfer.completed_chunk_bitmap,
                transfer.attempt_count,
                0,
                None,
                updated_at_unix_ms,
            )
        }

        fn complete_download(
            &self,
            transfer: &ObjectTransferRecord,
            descriptor: &ObjectDescriptor,
            _cache_path: &str,
            updated_at_unix_ms: i64,
        ) -> Result<(), ObjectTransferFailure> {
            if self.reject_download_completion.load(Ordering::Acquire) {
                return Err(ObjectTransferFailure::retryable(
                    ObjectTransferErrorCode::RetryLater,
                    None,
                    "test download completion lost its session-generation fence",
                ));
            }
            self.complete_upload(transfer, descriptor, updated_at_unix_ms)
        }
    }

    struct TestCodec;

    impl ObjectCommitmentCodec for TestCodec {
        fn upload_commitment(
            &self,
            transfer: &ObjectTransferRecord,
            object: &ObjectUploadSpec,
        ) -> Result<[u8; 32], ObjectTransferFailure> {
            let mut hash = Sha256::new();
            hash.update(transfer.owner_scope_id.as_bytes());
            hash.update(transfer.operation_id.as_bytes());
            hash.update(&object.ciphertext_sha256);
            Ok(hash.finalize().into())
        }

        fn descriptor_commitment(
            &self,
            descriptor: &ObjectDescriptor,
        ) -> Result<[u8; 32], ObjectTransferFailure> {
            Ok(Sha256::digest(&descriptor.commitment.ciphertext_sha256).into())
        }
    }

    struct MemoryTransport {
        chunks: Mutex<HashMap<u32, Vec<u8>>>,
        upload_calls: Mutex<Vec<u32>>,
        fail_upload_once: Mutex<Option<u32>>,
        fail_download_once: Mutex<Option<u32>>,
        retain_uploads: bool,
        corrupt_download_once: Mutex<Option<u32>>,
        reject_etag: AtomicBool,
        cancel_calls: AtomicUsize,
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
                reject_etag: AtomicBool::new(false),
                cancel_calls: AtomicUsize::new(0),
            }
        }

        fn without_upload_retention() -> Self {
            Self {
                retain_uploads: false,
                ..Self::new()
            }
        }
    }

    impl ObjectTransferTransport for MemoryTransport {
        fn begin_upload(
            &self,
            _transfer: &ObjectTransferRecord,
            prepared: &PreparedObjectUpload,
        ) -> Result<(String, u64, Vec<u8>), ObjectTransferFailure> {
            Ok((
                "upload-1".to_string(),
                1,
                vec![0; prepared.object.chunk_count.div_ceil(8) as usize],
            ))
        }

        fn put_upload_chunk(
            &self,
            _transfer: &ObjectTransferRecord,
            chunk: &EncryptedObjectChunk,
        ) -> Result<(), ObjectTransferFailure> {
            self.upload_calls.lock().unwrap().push(chunk.chunk_index);
            if *self.fail_upload_once.lock().unwrap() == Some(chunk.chunk_index) {
                *self.fail_upload_once.lock().unwrap() = None;
                return Err(ObjectTransferFailure::retryable(
                    ObjectTransferErrorCode::RetryLater,
                    None,
                    "injected upload interruption",
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
            _transfer: &ObjectTransferRecord,
            prepared: &PreparedObjectUpload,
        ) -> Result<ObjectDescriptor, ObjectTransferFailure> {
            Ok(ObjectDescriptor {
                object_id: "object-1".to_string(),
                storage_ref: "opaque-1".to_string(),
                commitment: prepared.object.clone(),
            })
        }

        fn get_download_chunk(
            &self,
            _transfer: &ObjectTransferRecord,
            _descriptor: &ObjectDescriptor,
            chunk_index: u32,
            _start: u64,
            _end: u64,
        ) -> Result<Vec<u8>, ObjectTransferFailure> {
            if self.reject_etag.load(Ordering::Acquire) {
                return Err(ObjectTransferFailure::terminal(
                    ObjectTransferErrorCode::DescriptorMismatch,
                    "secure content object range status 412 Precondition Failed",
                ));
            }
            if *self.fail_download_once.lock().unwrap() == Some(chunk_index) {
                *self.fail_download_once.lock().unwrap() = None;
                return Err(ObjectTransferFailure::retryable(
                    ObjectTransferErrorCode::RetryLater,
                    None,
                    "injected download interruption",
                ));
            }
            let mut bytes = self
                .chunks
                .lock()
                .unwrap()
                .get(&chunk_index)
                .cloned()
                .ok_or_else(|| {
                    ObjectTransferFailure::terminal(
                        ObjectTransferErrorCode::IntegrityFailed,
                        "missing test chunk",
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
            _transfer: &ObjectTransferRecord,
        ) -> Result<(), ObjectTransferFailure> {
            self.cancel_calls.fetch_add(1, Ordering::AcqRel);
            Ok(())
        }
    }

    struct GeneratedDownloadTransport {
        plaintext_size: u64,
        chunk_size: u32,
        download_calls: Mutex<Vec<u32>>,
    }

    impl ObjectTransferTransport for GeneratedDownloadTransport {
        fn begin_upload(
            &self,
            _transfer: &ObjectTransferRecord,
            _prepared: &PreparedObjectUpload,
        ) -> Result<(String, u64, Vec<u8>), ObjectTransferFailure> {
            Err(unsupported_transport_operation())
        }

        fn put_upload_chunk(
            &self,
            _transfer: &ObjectTransferRecord,
            _chunk: &EncryptedObjectChunk,
        ) -> Result<(), ObjectTransferFailure> {
            Err(unsupported_transport_operation())
        }

        fn complete_upload(
            &self,
            _transfer: &ObjectTransferRecord,
            _prepared: &PreparedObjectUpload,
        ) -> Result<ObjectDescriptor, ObjectTransferFailure> {
            Err(unsupported_transport_operation())
        }

        fn get_download_chunk(
            &self,
            _transfer: &ObjectTransferRecord,
            _descriptor: &ObjectDescriptor,
            chunk_index: u32,
            _start: u64,
            _end: u64,
        ) -> Result<Vec<u8>, ObjectTransferFailure> {
            self.download_calls.lock().unwrap().push(chunk_index);
            let material = ObjectCryptoMaterial::from_parts(
                [7; 32],
                [0; 12],
                self.plaintext_size,
                self.chunk_size,
            )
            .map_err(ObjectTransferFailure::from)?;
            let plaintext = vec![0; expected_plaintext_chunk_size(&material, chunk_index)?];
            Ok(encrypt_object_chunk(&material, chunk_index, &plaintext)?.ciphertext)
        }

        fn cancel_upload(
            &self,
            _transfer: &ObjectTransferRecord,
        ) -> Result<(), ObjectTransferFailure> {
            Err(unsupported_transport_operation())
        }
    }

    fn unsupported_transport_operation() -> ObjectTransferFailure {
        ObjectTransferFailure::terminal(
            ObjectTransferErrorCode::DescriptorMismatch,
            "unsupported test transport operation",
        )
    }

    fn test_ref(label: &str) -> String {
        format!("memory://secure-content-{label}")
    }

    fn record(
        transfer_id: &str,
        source: &str,
        partial: &str,
        plaintext_size: u64,
        chunk_size: u32,
    ) -> ObjectTransferRecord {
        ObjectTransferRecord {
            transfer_id: transfer_id.to_string(),
            owner_scope_id: "conversation-1".to_string(),
            operation_id: "message-1".to_string(),
            authority_id: "station-1".to_string(),
            direction: ObjectTransferDirection::Upload,
            state: ObjectTransferState::Queued,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![
                0;
                plaintext_size.div_ceil(u64::from(chunk_size)).div_ceil(8)
                    as usize
            ],
            source_local_ref: source.to_string(),
            partial_local_ref: partial.to_string(),
            object_key: vec![7; 32],
            base_nonce: vec![0; 12],
            plaintext_size,
            chunk_size,
            attempt_count: 0,
            next_attempt_at_unix_ms: 1,
            last_error: None,
            updated_at_unix_ms: 1,
        }
    }

    fn prepared_object(
        blobs: &MemoryBlob,
        source: &str,
        transfer: &ObjectTransferRecord,
    ) -> (ObjectCryptoMaterial, PreparedObjectUpload, ObjectDescriptor) {
        let material = material_from_transfer(transfer).unwrap();
        let prepared = prepare_upload(
            blobs,
            source,
            &material,
            transfer,
            Some("application/octet-stream".to_string()),
            &TestCodec,
        )
        .unwrap();
        let descriptor = ObjectDescriptor {
            object_id: "object-1".to_string(),
            storage_ref: "opaque-1".to_string(),
            commitment: prepared.object.clone(),
        };
        (material, prepared, descriptor)
    }

    fn seed_encrypted_chunks(
        transport: &MemoryTransport,
        blobs: &MemoryBlob,
        source: &str,
        material: &ObjectCryptoMaterial,
    ) {
        for chunk_index in 0..material.chunk_count() {
            let plaintext = read_plaintext_chunk(blobs, source, material, chunk_index).unwrap();
            let encrypted = encrypt_object_chunk(material, chunk_index, &plaintext).unwrap();
            transport
                .chunks
                .lock()
                .unwrap()
                .insert(chunk_index, encrypted.ciphertext);
        }
    }

    #[test]
    fn upload_resumes_from_the_verified_bitmap() {
        let source = "memory://source";
        let partial = "memory://partial";
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(source, vec![31; OBJECT_CHUNK_SIZE as usize + 17]);
        let store = Arc::new(TestStore::default());
        store.records.lock().unwrap().insert(
            "transfer-1".to_string(),
            record(
                "transfer-1",
                source,
                partial,
                u64::from(OBJECT_CHUNK_SIZE) + 17,
                OBJECT_CHUNK_SIZE,
            ),
        );
        let transport = Arc::new(MemoryTransport::new());
        *transport.fail_upload_once.lock().unwrap() = Some(1);
        let worker =
            ObjectTransferWorker::new(store.clone(), transport.clone(), blobs, Arc::new(TestCodec));

        assert!(matches!(
            worker.run_upload_once("transfer-1", 10).unwrap(),
            ObjectTransferProgress::RetryScheduled { .. }
        ));
        let due = store
            .records
            .lock()
            .unwrap()
            .get("transfer-1")
            .unwrap()
            .next_attempt_at_unix_ms;
        assert_eq!(
            worker.run_upload_once("transfer-1", due).unwrap(),
            ObjectTransferProgress::Complete
        );
        assert_eq!(*transport.upload_calls.lock().unwrap(), vec![0, 1, 1]);
        assert_eq!(
            store.records.lock().unwrap()["transfer-1"].state,
            ObjectTransferState::Complete
        );
    }

    #[test]
    fn upload_resumes_after_interruption_at_every_chunk() {
        let source = test_ref("upload-every-chunk-source");
        let partial = test_ref("upload-every-chunk-partial");
        let plaintext = vec![37_u8; 2 * 1024 * 1024 + 41];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());

        for interrupted_chunk in 0..3 {
            let transfer_id = format!("upload-every-chunk-{interrupted_chunk}");
            let store = Arc::new(TestStore::default());
            store.insert(record(
                &transfer_id,
                &source,
                &partial,
                plaintext.len() as u64,
                1024 * 1024,
            ));
            let transport = Arc::new(MemoryTransport::new());
            *transport.fail_upload_once.lock().unwrap() = Some(interrupted_chunk);
            let worker = ObjectTransferWorker::new(
                store.clone(),
                transport.clone(),
                blobs.clone(),
                Arc::new(TestCodec),
            );

            assert!(worker.upload_once(&transfer_id, 10).is_err());
            let interrupted = store.record(&transfer_id);
            for chunk_index in 0..3 {
                assert_eq!(
                    chunk_complete(&interrupted.completed_chunk_bitmap, chunk_index),
                    chunk_index < interrupted_chunk
                );
            }

            worker.upload_once(&transfer_id, 11).unwrap();
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
                store.record(&transfer_id).state,
                ObjectTransferState::Complete
            );
        }
    }

    #[test]
    fn download_resumes_then_atomically_promotes_verified_plaintext() {
        let source = test_ref("download-source");
        let partial = test_ref("download-partial");
        let cache = test_ref("download-cache");
        let plaintext = (0..(2 * 1024 * 1024 + 41))
            .map(|value| (value * 3) as u8)
            .collect::<Vec<_>>();
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let upload_record = record(
            "unused",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let (material, _, descriptor) = prepared_object(blobs.as_ref(), &source, &upload_record);
        let transport = Arc::new(MemoryTransport::new());
        seed_encrypted_chunks(transport.as_ref(), blobs.as_ref(), &source, &material);
        let plaintext_hash: [u8; 32] = Sha256::digest(&plaintext).into();
        let store = Arc::new(TestStore::default());
        let mut download_record = record(
            "download-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        store.insert(download_record);
        *transport.fail_download_once.lock().unwrap() = Some(1);
        let worker =
            ObjectTransferWorker::new(store, transport, blobs.clone(), Arc::new(TestCodec));

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
        assert!(!blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
        let checkpoint = blobs.bytes(&partial).unwrap();
        assert_eq!(
            checkpoint.len(),
            expected_ciphertext_chunk_size(&material, 0).unwrap()
        );
        assert_eq!(
            Sha256::digest(&checkpoint).as_slice(),
            descriptor.commitment.chunk_ciphertext_sha256[0]
        );
        assert_ne!(
            checkpoint,
            plaintext[..expected_plaintext_chunk_size(&material, 0).unwrap()]
        );

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
    fn stale_generation_download_completion_keeps_ciphertext_and_releases_no_plaintext() {
        let source = test_ref("stale-completion-source");
        let partial = test_ref("stale-completion-partial");
        let cache = test_ref("stale-completion-cache");
        let plaintext = b"generation-fenced private media".to_vec();
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let upload_record = record(
            "stale-completion-descriptor",
            &source,
            &partial,
            plaintext.len() as u64,
            OBJECT_CHUNK_SIZE,
        );
        let (material, _, descriptor) = prepared_object(blobs.as_ref(), &source, &upload_record);
        let transport = Arc::new(MemoryTransport::new());
        seed_encrypted_chunks(transport.as_ref(), blobs.as_ref(), &source, &material);
        let store = Arc::new(TestStore::default());
        let mut download_record = record(
            "stale-completion-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            OBJECT_CHUNK_SIZE,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        store.insert(download_record);
        store
            .reject_download_completion
            .store(true, Ordering::Release);
        let worker =
            ObjectTransferWorker::new(store.clone(), transport, blobs.clone(), Arc::new(TestCodec));

        assert!(worker
            .run_download_once(
                "stale-completion-transfer",
                &descriptor,
                &Sha256::digest(&plaintext).into(),
                &cache,
                10,
            )
            .is_err());

        assert_ne!(
            store.record("stale-completion-transfer").state,
            ObjectTransferState::Complete
        );
        assert!(blobs.exists(&partial).unwrap());
        assert!(!blobs.exists(&cache).unwrap());
        assert!(!blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
        assert_ne!(blobs.bytes(&partial).unwrap(), plaintext);
    }

    #[test]
    fn completed_download_recovers_after_plaintext_promotion_failure() {
        let source = test_ref("promotion-recovery-source");
        let partial = test_ref("promotion-recovery-partial");
        let cache = test_ref("promotion-recovery-cache");
        let plaintext = b"recoverable generation-fenced private media".to_vec();
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let upload_record = record(
            "promotion-recovery-descriptor",
            &source,
            &partial,
            plaintext.len() as u64,
            OBJECT_CHUNK_SIZE,
        );
        let (material, _, descriptor) = prepared_object(blobs.as_ref(), &source, &upload_record);
        let transport = Arc::new(MemoryTransport::new());
        seed_encrypted_chunks(transport.as_ref(), blobs.as_ref(), &source, &material);
        let store = Arc::new(TestStore::default());
        let mut download_record = record(
            "promotion-recovery-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            OBJECT_CHUNK_SIZE,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        store.insert(download_record);
        blobs.reject_next_promotion();
        let worker =
            ObjectTransferWorker::new(store.clone(), transport, blobs.clone(), Arc::new(TestCodec));
        let plaintext_hash = Sha256::digest(&plaintext).into();

        let failure = worker
            .run_download_once(
                "promotion-recovery-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                10,
            )
            .unwrap_err();

        assert!(failure.retryable);
        assert_eq!(
            store.record("promotion-recovery-transfer").state,
            ObjectTransferState::Complete
        );
        assert!(!blobs.exists(&cache).unwrap());
        assert!(blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
        assert!(blobs.exists(&partial).unwrap());

        assert_eq!(
            worker
                .run_download_once(
                    "promotion-recovery-transfer",
                    &descriptor,
                    &plaintext_hash,
                    &cache,
                    11,
                )
                .unwrap(),
            ObjectTransferProgress::Complete
        );
        assert_eq!(blobs.bytes(&cache).unwrap(), plaintext);
        assert!(!blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
        assert!(!blobs.exists(&partial).unwrap());
    }

    #[test]
    fn download_resumes_after_interruption_at_every_chunk() {
        let source = test_ref("download-every-chunk-source");
        let plaintext = vec![53_u8; 2 * 1024 * 1024 + 41];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let upload_record = record(
            "download-every-chunk-upload",
            &source,
            &test_ref("download-every-chunk-unused"),
            plaintext.len() as u64,
            1024 * 1024,
        );
        let (material, _, descriptor) = prepared_object(blobs.as_ref(), &source, &upload_record);
        let transport = Arc::new(MemoryTransport::new());
        seed_encrypted_chunks(transport.as_ref(), blobs.as_ref(), &source, &material);
        let plaintext_hash: [u8; 32] = Sha256::digest(&plaintext).into();

        for interrupted_chunk in 0..3 {
            let transfer_id = format!("download-every-chunk-{interrupted_chunk}");
            let partial = test_ref(&format!("download-every-chunk-partial-{interrupted_chunk}"));
            let cache = test_ref(&format!("download-every-chunk-cache-{interrupted_chunk}"));
            let store = Arc::new(TestStore::default());
            let mut download_record = record(
                &transfer_id,
                &source,
                &partial,
                plaintext.len() as u64,
                1024 * 1024,
            );
            download_record.direction = ObjectTransferDirection::Download;
            download_record.source_local_ref.clear();
            store.insert(download_record);
            *transport.fail_download_once.lock().unwrap() = Some(interrupted_chunk);
            let worker = ObjectTransferWorker::new(
                store.clone(),
                transport.clone(),
                blobs.clone(),
                Arc::new(TestCodec),
            );

            assert!(worker
                .download_once(&transfer_id, &descriptor, &plaintext_hash, &cache, 10)
                .is_err());
            let interrupted = store.record(&transfer_id);
            for chunk_index in 0..3 {
                assert_eq!(
                    chunk_complete(&interrupted.completed_chunk_bitmap, chunk_index),
                    chunk_index < interrupted_chunk
                );
            }

            worker
                .download_once(&transfer_id, &descriptor, &plaintext_hash, &cache, 11)
                .unwrap();
            assert_eq!(blobs.bytes(&cache).unwrap(), plaintext);
            assert!(!blobs.exists(&partial).unwrap());
            blobs.remove(&cache).unwrap();
        }
    }

    #[test]
    fn partial_checkpoint_mismatch_is_deleted_and_fails_closed() {
        let source = test_ref("mismatch-source");
        let partial = test_ref("mismatch-partial");
        let cache = test_ref("mismatch-cache");
        let plaintext_size = 1024 * 1024 + 17;
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![1_u8; plaintext_size]);
        blobs.put(&partial, vec![1_u8; 2]);
        let upload_record = record(
            "unused",
            &source,
            &partial,
            plaintext_size as u64,
            1024 * 1024,
        );
        let (_, _, descriptor) = prepared_object(blobs.as_ref(), &source, &upload_record);
        let store = Arc::new(TestStore::default());
        let mut download_record = record(
            "mismatch-transfer",
            &source,
            &partial,
            plaintext_size as u64,
            1024 * 1024,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        download_record.completed_chunk_bitmap = vec![1];
        store.insert(download_record);
        let worker = ObjectTransferWorker::new(
            store,
            Arc::new(MemoryTransport::new()),
            blobs.clone(),
            Arc::new(TestCodec),
        );

        assert!(worker
            .download_once("mismatch-transfer", &descriptor, &[0; 32], &cache, 10)
            .is_err());
        assert!(!blobs.exists(&partial).unwrap());
    }

    #[test]
    fn same_length_partial_corruption_is_deleted_and_fails_closed() {
        let source = test_ref("corrupt-partial-source");
        let partial = test_ref("corrupt-partial");
        let cache = test_ref("corrupt-partial-cache");
        let plaintext = vec![7_u8; 2 * 1024 * 1024 + 17];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        blobs.put(&partial, vec![9_u8; 1024 * 1024]);
        let upload_record = record(
            "unused",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let (_, _, descriptor) = prepared_object(blobs.as_ref(), &source, &upload_record);
        let store = Arc::new(TestStore::default());
        let mut download_record = record(
            "corrupt-partial-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        download_record.completed_chunk_bitmap = vec![1];
        store.insert(download_record);
        let worker = ObjectTransferWorker::new(
            store,
            Arc::new(MemoryTransport::new()),
            blobs.clone(),
            Arc::new(TestCodec),
        );

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
    fn uncheckpointed_ciphertext_tail_is_discarded_before_resume() {
        let source = test_ref("uncheckpointed-tail-source");
        let partial = test_ref("uncheckpointed-tail-partial");
        let plaintext = vec![19_u8; 1024 * 1024 + 17];
        let blobs = MemoryBlob::default();
        blobs.put(&source, plaintext);
        let mut download_record = record(
            "uncheckpointed-tail-transfer",
            &source,
            &partial,
            1024 * 1024 + 17,
            1024 * 1024,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        set_chunk_complete(&mut download_record.completed_chunk_bitmap, 0);
        let (material, _, descriptor) = prepared_object(
            &blobs,
            &source,
            &record(
                "uncheckpointed-tail-descriptor",
                &source,
                &partial,
                1024 * 1024 + 17,
                1024 * 1024,
            ),
        );
        let first_plaintext = read_plaintext_chunk(&blobs, &source, &material, 0).unwrap();
        let first_ciphertext = encrypt_object_chunk(&material, 0, &first_plaintext)
            .unwrap()
            .ciphertext;
        let second_plaintext = read_plaintext_chunk(&blobs, &source, &material, 1).unwrap();
        let second_ciphertext = encrypt_object_chunk(&material, 1, &second_plaintext)
            .unwrap()
            .ciphertext;
        let mut checkpoint = first_ciphertext.clone();
        checkpoint.extend(second_ciphertext);
        blobs.put(&partial, checkpoint);

        validate_partial_ciphertext(&blobs, &download_record, &material, &descriptor).unwrap();

        assert_eq!(blobs.bytes(&partial).unwrap(), first_ciphertext);
    }

    #[test]
    fn non_contiguous_ciphertext_checkpoint_is_deleted_and_fails_closed() {
        let source = test_ref("sparse-checkpoint-source");
        let partial = test_ref("sparse-checkpoint-partial");
        let cache = test_ref("sparse-checkpoint-cache");
        let plaintext = vec![23_u8; 1024 * 1024 + 17];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let descriptor_record = record(
            "sparse-checkpoint-descriptor",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let (material, _, descriptor) =
            prepared_object(blobs.as_ref(), &source, &descriptor_record);
        let first_plaintext = read_plaintext_chunk(blobs.as_ref(), &source, &material, 0).unwrap();
        let first_ciphertext = encrypt_object_chunk(&material, 0, &first_plaintext)
            .unwrap()
            .ciphertext;
        let second_plaintext = read_plaintext_chunk(blobs.as_ref(), &source, &material, 1).unwrap();
        let second_ciphertext = encrypt_object_chunk(&material, 1, &second_plaintext)
            .unwrap()
            .ciphertext;
        let mut checkpoint = first_ciphertext;
        checkpoint.extend(second_ciphertext);
        blobs.put(&partial, checkpoint);
        let mut download_record = record(
            "sparse-checkpoint-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        set_chunk_complete(&mut download_record.completed_chunk_bitmap, 1);
        let store = Arc::new(TestStore::default());
        store.insert(download_record);
        let worker = ObjectTransferWorker::new(
            store,
            Arc::new(MemoryTransport::new()),
            blobs.clone(),
            Arc::new(TestCodec),
        );

        assert!(worker
            .download_once(
                "sparse-checkpoint-transfer",
                &descriptor,
                &Sha256::digest(&plaintext).into(),
                &cache,
                10,
            )
            .is_err());
        assert!(!blobs.exists(&partial).unwrap());
        assert!(!blobs.exists(&cache).unwrap());
        assert!(!blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
    }

    #[test]
    fn whole_ciphertext_hash_mismatch_cleans_checkpoint_before_decrypt() {
        let source = test_ref("whole-ciphertext-source");
        let partial = test_ref("whole-ciphertext-partial");
        let cache = test_ref("whole-ciphertext-cache");
        let plaintext = vec![29_u8; 1024 * 1024 + 17];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let descriptor_record = record(
            "whole-ciphertext-descriptor",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let (material, _, mut descriptor) =
            prepared_object(blobs.as_ref(), &source, &descriptor_record);
        descriptor.commitment.ciphertext_sha256[0] ^= 1;
        let transport = Arc::new(MemoryTransport::new());
        seed_encrypted_chunks(transport.as_ref(), blobs.as_ref(), &source, &material);
        let mut download_record = record(
            "whole-ciphertext-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        let store = Arc::new(TestStore::default());
        store.insert(download_record);
        let worker =
            ObjectTransferWorker::new(store, transport, blobs.clone(), Arc::new(TestCodec));

        assert!(worker
            .download_once(
                "whole-ciphertext-transfer",
                &descriptor,
                &Sha256::digest(&plaintext).into(),
                &cache,
                10,
            )
            .is_err());
        assert!(!blobs.exists(&partial).unwrap());
        assert!(!blobs.exists(&cache).unwrap());
        assert!(!blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
    }

    #[test]
    fn aead_failure_cleans_ciphertext_and_plaintext_artifacts() {
        let source = test_ref("aead-failure-source");
        let partial = test_ref("aead-failure-partial");
        let cache = test_ref("aead-failure-cache");
        let plaintext = vec![31_u8; 1024 * 1024 + 17];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let descriptor_record = record(
            "aead-failure-descriptor",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let (material, _, descriptor) =
            prepared_object(blobs.as_ref(), &source, &descriptor_record);
        let transport = Arc::new(MemoryTransport::new());
        seed_encrypted_chunks(transport.as_ref(), blobs.as_ref(), &source, &material);
        let mut download_record = record(
            "aead-failure-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        download_record.object_key = vec![8; 32];
        let store = Arc::new(TestStore::default());
        store.insert(download_record);
        let worker =
            ObjectTransferWorker::new(store, transport, blobs.clone(), Arc::new(TestCodec));

        assert!(worker
            .download_once(
                "aead-failure-transfer",
                &descriptor,
                &Sha256::digest(&plaintext).into(),
                &cache,
                10,
            )
            .is_err());
        assert!(!blobs.exists(&partial).unwrap());
        assert!(!blobs.exists(&cache).unwrap());
        assert!(!blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
    }

    #[test]
    fn plaintext_hash_failure_never_promotes_and_cleans_staging() {
        let source = test_ref("plaintext-hash-source");
        let partial = test_ref("plaintext-hash-partial");
        let cache = test_ref("plaintext-hash-cache");
        let plaintext = vec![37_u8; 1024 * 1024 + 17];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let descriptor_record = record(
            "plaintext-hash-descriptor",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let (material, _, descriptor) =
            prepared_object(blobs.as_ref(), &source, &descriptor_record);
        let transport = Arc::new(MemoryTransport::new());
        seed_encrypted_chunks(transport.as_ref(), blobs.as_ref(), &source, &material);
        let mut download_record = record(
            "plaintext-hash-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        let store = Arc::new(TestStore::default());
        store.insert(download_record);
        let worker =
            ObjectTransferWorker::new(store, transport, blobs.clone(), Arc::new(TestCodec));

        assert!(worker
            .download_once("plaintext-hash-transfer", &descriptor, &[0; 32], &cache, 10,)
            .is_err());
        assert!(!blobs.exists(&partial).unwrap());
        assert!(!blobs.exists(&cache).unwrap());
        assert!(!blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
    }

    #[test]
    fn corrupt_download_chunk_and_wrong_etag_fail_closed() {
        let source = test_ref("corrupt-download-source");
        let partial = test_ref("corrupt-download-partial");
        let cache = test_ref("corrupt-download-cache");
        let plaintext = vec![5_u8; 1024 * 1024 + 17];
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        let upload_record = record(
            "unused",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        let (material, _, descriptor) = prepared_object(blobs.as_ref(), &source, &upload_record);
        let transport = Arc::new(MemoryTransport::new());
        seed_encrypted_chunks(transport.as_ref(), blobs.as_ref(), &source, &material);
        let plaintext_hash: [u8; 32] = Sha256::digest(&plaintext).into();
        let store = Arc::new(TestStore::default());
        let mut download_record = record(
            "corrupt-download-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            1024 * 1024,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        store.insert(download_record);
        let worker =
            ObjectTransferWorker::new(store, transport.clone(), blobs.clone(), Arc::new(TestCodec));

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

        transport.reject_etag.store(true, Ordering::Release);
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
    fn completed_download_revalidates_cached_plaintext_before_reuse() {
        let source = test_ref("completed-download-source");
        let partial = test_ref("completed-download-partial");
        let cache = test_ref("completed-download-cache");
        let plaintext = b"expected private media".to_vec();
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        blobs.put(&cache, b"tampered private media".to_vec());
        let descriptor_record = record(
            "descriptor",
            &source,
            &partial,
            plaintext.len() as u64,
            OBJECT_CHUNK_SIZE,
        );
        let (_, _, descriptor) = prepared_object(blobs.as_ref(), &source, &descriptor_record);
        blobs.put(&partial, b"stale ciphertext".to_vec());
        blobs.put(
            &plaintext_staging_ref(&cache),
            b"partial plaintext".to_vec(),
        );
        let mut download_record = record(
            "completed-download-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            OBJECT_CHUNK_SIZE,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        download_record.state = ObjectTransferState::Complete;
        download_record.descriptor_sha256 = TestCodec
            .descriptor_commitment(&descriptor)
            .unwrap()
            .to_vec();
        let store = Arc::new(TestStore::default());
        store.insert(download_record);
        let worker = ObjectTransferWorker::new(
            store,
            Arc::new(MemoryTransport::new()),
            blobs.clone(),
            Arc::new(TestCodec),
        );

        assert!(worker
            .run_download_once(
                "completed-download-transfer",
                &descriptor,
                &Sha256::digest(&plaintext).into(),
                &cache,
                10,
            )
            .is_err());
        assert!(!blobs.exists(&cache).unwrap());
        assert!(!blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
        assert!(!blobs.exists(&partial).unwrap());
    }

    #[test]
    fn completed_download_reuses_only_a_descriptor_bound_valid_cache() {
        let source = test_ref("valid-completed-download-source");
        let partial = test_ref("valid-completed-download-partial");
        let cache = test_ref("valid-completed-download-cache");
        let plaintext = b"verified private media".to_vec();
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        blobs.put(&partial, b"stale ciphertext".to_vec());
        blobs.put(&cache, plaintext.clone());
        blobs.put(
            &plaintext_staging_ref(&cache),
            b"partial plaintext".to_vec(),
        );
        let descriptor_record = record(
            "valid-completed-descriptor",
            &source,
            &partial,
            plaintext.len() as u64,
            OBJECT_CHUNK_SIZE,
        );
        let (_, _, descriptor) = prepared_object(blobs.as_ref(), &source, &descriptor_record);
        let mut download_record = record(
            "valid-completed-download-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            OBJECT_CHUNK_SIZE,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        download_record.state = ObjectTransferState::Complete;
        download_record.descriptor_sha256 = TestCodec
            .descriptor_commitment(&descriptor)
            .unwrap()
            .to_vec();
        let store = Arc::new(TestStore::default());
        store.insert(download_record);
        let worker = ObjectTransferWorker::new(
            store,
            Arc::new(MemoryTransport::new()),
            blobs.clone(),
            Arc::new(TestCodec),
        );

        assert_eq!(
            worker
                .run_download_once(
                    "valid-completed-download-transfer",
                    &descriptor,
                    &Sha256::digest(&plaintext).into(),
                    &cache,
                    10,
                )
                .unwrap(),
            ObjectTransferProgress::Complete
        );
        assert_eq!(blobs.bytes(&cache).unwrap(), plaintext);
        assert!(!blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
        assert!(!blobs.exists(&partial).unwrap());
    }

    #[test]
    fn hundred_mib_upload_resumes_at_quarter_boundaries() {
        const SIZE: u64 = 100 * 1024 * 1024;
        const CHUNKS: u32 = 100;
        let source = test_ref("hundred-mib-source");
        let partial = test_ref("hundred-mib-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![0; SIZE as usize]);

        for completed_chunks in [25_u32, 50, 75] {
            let transfer_id = format!("hundred-mib-{completed_chunks}");
            let store = Arc::new(TestStore::default());
            let mut upload_record = record(&transfer_id, &source, &partial, SIZE, 1024 * 1024);
            upload_record.upload_id = format!("upload-{completed_chunks}");
            upload_record.generation = 1;
            for chunk_index in 0..completed_chunks {
                set_chunk_complete(&mut upload_record.completed_chunk_bitmap, chunk_index);
            }
            store.insert(upload_record);
            let transport = Arc::new(MemoryTransport::without_upload_retention());
            let worker = ObjectTransferWorker::new(
                store.clone(),
                transport.clone(),
                blobs.clone(),
                Arc::new(TestCodec),
            );

            worker.upload_once(&transfer_id, 10).unwrap();

            let calls = transport.upload_calls.lock().unwrap();
            assert_eq!(calls.len(), (CHUNKS - completed_chunks) as usize);
            assert_eq!(calls.first().copied(), Some(completed_chunks));
            assert_eq!(calls.last().copied(), Some(CHUNKS - 1));
            assert_eq!(
                store.record(&transfer_id).state,
                ObjectTransferState::Complete
            );
        }
    }

    #[test]
    fn hundred_mib_download_resumes_at_quarter_boundaries() {
        const SIZE: u64 = 100 * 1024 * 1024;
        const CHUNKS: u32 = 100;
        let source = test_ref("hundred-mib-download-source");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![0; SIZE as usize]);
        let descriptor_record = record(
            "descriptor",
            &source,
            &test_ref("descriptor-partial"),
            SIZE,
            1024 * 1024,
        );
        let (material, _, descriptor) =
            prepared_object(blobs.as_ref(), &source, &descriptor_record);
        let plaintext_hash = blobs.sha256(&source).unwrap();

        for completed_chunks in [25_u32, 50, 75] {
            let transfer_id = format!("hundred-mib-download-{completed_chunks}");
            let partial = test_ref(&format!("hundred-mib-download-partial-{completed_chunks}"));
            let cache = test_ref(&format!("hundred-mib-download-cache-{completed_chunks}"));
            let partial_ciphertext = (0..completed_chunks)
                .flat_map(|index| {
                    let plaintext =
                        read_plaintext_chunk(blobs.as_ref(), &source, &material, index).unwrap();
                    encrypt_object_chunk(&material, index, &plaintext)
                        .unwrap()
                        .ciphertext
                })
                .collect();
            blobs.put(&partial, partial_ciphertext);
            let store = Arc::new(TestStore::default());
            let mut download_record = record(&transfer_id, &source, &partial, SIZE, 1024 * 1024);
            download_record.direction = ObjectTransferDirection::Download;
            download_record.source_local_ref.clear();
            for chunk_index in 0..completed_chunks {
                set_chunk_complete(&mut download_record.completed_chunk_bitmap, chunk_index);
            }
            store.insert(download_record);
            let transport = Arc::new(GeneratedDownloadTransport {
                plaintext_size: SIZE,
                chunk_size: 1024 * 1024,
                download_calls: Mutex::new(Vec::new()),
            });
            let worker = ObjectTransferWorker::new(
                store,
                transport.clone(),
                blobs.clone(),
                Arc::new(TestCodec),
            );

            worker
                .download_once(&transfer_id, &descriptor, &plaintext_hash, &cache, 10)
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
        let source = test_ref("cancel-source");
        let partial = test_ref("cancel-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![1_u8; 1024 * 1024]);
        blobs.put(&partial, vec![2_u8; 1024]);
        let store = Arc::new(TestStore::default());
        let mut transfer = record(
            "cancel-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        );
        transfer.upload_id = "upload-cancel".to_string();
        transfer.generation = 7;
        store.insert(transfer);
        let transport = Arc::new(MemoryTransport::new());
        let worker = ObjectTransferWorker::new(
            store.clone(),
            transport.clone(),
            blobs.clone(),
            Arc::new(TestCodec),
        );

        worker.cancel("cancel-transfer", 10).unwrap();
        worker.cancel("cancel-transfer", 11).unwrap();

        assert_eq!(transport.cancel_calls.load(Ordering::Acquire), 1);
        assert!(!blobs.exists(&partial).unwrap());
        assert_eq!(
            store.record("cancel-transfer").state,
            ObjectTransferState::Cancelled
        );
    }

    #[test]
    fn completed_upload_can_be_cancelled_while_unattached() {
        let source = test_ref("completed-upload-source");
        let partial = test_ref("completed-upload-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![1_u8; 1024]);
        let store = Arc::new(TestStore::default());
        let mut transfer = record("completed-upload", &source, &partial, 1024, 1024);
        transfer.upload_id = "upload-complete".to_string();
        transfer.generation = 3;
        transfer.state = ObjectTransferState::Complete;
        store.insert(transfer);
        let transport = Arc::new(MemoryTransport::new());
        let worker =
            ObjectTransferWorker::new(store.clone(), transport.clone(), blobs, Arc::new(TestCodec));

        worker.cancel("completed-upload", 10).unwrap();

        assert_eq!(transport.cancel_calls.load(Ordering::Acquire), 1);
        assert_eq!(
            store.record("completed-upload").state,
            ObjectTransferState::Cancelled
        );
    }

    #[test]
    fn retryable_failure_persists_jittered_backoff_and_respects_due_time() {
        let source = test_ref("retry-source");
        let partial = test_ref("retry-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![3_u8; 1024 * 1024]);
        let store = Arc::new(TestStore::default());
        store.insert(record(
            "retry-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        ));
        let transport = Arc::new(MemoryTransport::new());
        *transport.fail_upload_once.lock().unwrap() = Some(0);
        let worker =
            ObjectTransferWorker::new(store.clone(), transport.clone(), blobs, Arc::new(TestCodec));

        let scheduled = worker.run_upload_once("retry-transfer", 10_000).unwrap();
        let next_attempt_at_unix_ms = match scheduled {
            ObjectTransferProgress::RetryScheduled {
                next_attempt_at_unix_ms,
            } => next_attempt_at_unix_ms,
            other => panic!("expected retry, got {other:?}"),
        };
        assert!((10_750..=11_250).contains(&next_attempt_at_unix_ms));
        let persisted = store.record("retry-transfer");
        assert_eq!(persisted.state, ObjectTransferState::RetryWait);
        assert_eq!(persisted.attempt_count, 1);
        assert_eq!(
            persisted.last_error,
            Some(ObjectTransferErrorCode::RetryLater)
        );
        assert_eq!(
            worker
                .run_upload_once("retry-transfer", next_attempt_at_unix_ms - 1)
                .unwrap(),
            ObjectTransferProgress::Deferred {
                next_attempt_at_unix_ms
            }
        );
        assert_eq!(*transport.upload_calls.lock().unwrap(), vec![0]);

        assert_eq!(
            worker
                .run_upload_once("retry-transfer", next_attempt_at_unix_ms)
                .unwrap(),
            ObjectTransferProgress::Complete
        );
    }

    #[test]
    fn integrity_failure_is_terminal_and_not_retried() {
        let source = test_ref("terminal-source");
        let partial = test_ref("terminal-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![1_u8]);
        let store = Arc::new(TestStore::default());
        store.insert(record(
            "terminal-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        ));
        let worker = ObjectTransferWorker::new(
            store.clone(),
            Arc::new(MemoryTransport::new()),
            blobs,
            Arc::new(TestCodec),
        );

        assert_eq!(
            worker.run_upload_once("terminal-transfer", 10_000).unwrap(),
            ObjectTransferProgress::Terminal {
                code: ObjectTransferErrorCode::IntegrityFailed
            }
        );
        let persisted = store.record("terminal-transfer");
        assert_eq!(persisted.state, ObjectTransferState::Terminal);
        assert_eq!(persisted.next_attempt_at_unix_ms, 0);
        assert!(worker.run_upload_once("terminal-transfer", 20_000).is_err());
    }

    #[test]
    fn server_retry_after_takes_precedence_and_remains_capped() {
        let source = test_ref("retry-after-source");
        let partial = test_ref("retry-after-partial");
        let store = Arc::new(TestStore::default());
        store.insert(record(
            "retry-after-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        ));
        let worker = ObjectTransferWorker::new(
            store.clone(),
            Arc::new(MemoryTransport::new()),
            Arc::new(MemoryBlob::default()),
            Arc::new(TestCodec),
        );

        assert_eq!(
            worker
                .persist_failure(
                    "retry-after-transfer",
                    10_000,
                    ObjectTransferFailure::retryable(
                        ObjectTransferErrorCode::QuotaExceeded,
                        Some(600_000),
                        "station quota",
                    ),
                )
                .unwrap(),
            ObjectTransferProgress::RetryScheduled {
                next_attempt_at_unix_ms: 310_000
            }
        );
        let persisted = store.record("retry-after-transfer");
        assert_eq!(persisted.next_attempt_at_unix_ms, 310_000);
        assert_eq!(
            persisted.last_error,
            Some(ObjectTransferErrorCode::QuotaExceeded)
        );
    }

    #[test]
    fn shutdown_and_fifth_active_transfer_are_durably_deferred() {
        let source = test_ref("bounded-source");
        let partial = test_ref("bounded-partial");
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, vec![4_u8; 1024 * 1024]);
        let control = Arc::new(ObjectTransferControl::new());
        let permits = (0..OBJECT_MAX_ACTIVE_TRANSFERS)
            .map(|index| control.try_admit(&format!("active-{index}")).unwrap())
            .collect::<Vec<_>>();
        let store = Arc::new(TestStore::default());
        store.insert(record(
            "bounded-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        ));
        let transport = Arc::new(MemoryTransport::new());
        let worker = ObjectTransferWorker::with_control(
            store.clone(),
            transport.clone(),
            blobs,
            Arc::new(TestCodec),
            control.clone(),
            ObjectRetryPolicy::default(),
        )
        .unwrap();

        assert!(matches!(
            worker.run_upload_once("bounded-transfer", 10_000).unwrap(),
            ObjectTransferProgress::RetryScheduled { .. }
        ));
        drop(permits);
        let due = store.record("bounded-transfer").next_attempt_at_unix_ms;
        control.request_shutdown();
        assert!(matches!(
            worker.run_upload_once("bounded-transfer", due).unwrap(),
            ObjectTransferProgress::RetryScheduled { .. }
        ));
        assert!(transport.upload_calls.lock().unwrap().is_empty());
    }

    #[test]
    fn shutdown_cleans_unverified_plaintext_and_preserves_ciphertext_checkpoint() {
        let source = test_ref("shutdown-download-source");
        let partial = test_ref("shutdown-download-partial");
        let cache = test_ref("shutdown-download-cache");
        let plaintext = b"shutdown private media".to_vec();
        let blobs = Arc::new(MemoryBlob::default());
        blobs.put(&source, plaintext.clone());
        blobs.put(&partial, b"ciphertext checkpoint".to_vec());
        blobs.put(&cache, b"unverified plaintext".to_vec());
        blobs.put(
            &plaintext_staging_ref(&cache),
            b"partial plaintext".to_vec(),
        );
        let descriptor_record = record(
            "shutdown-download-descriptor",
            &source,
            &partial,
            plaintext.len() as u64,
            OBJECT_CHUNK_SIZE,
        );
        let (_, _, descriptor) = prepared_object(blobs.as_ref(), &source, &descriptor_record);
        let mut download_record = record(
            "shutdown-download-transfer",
            &source,
            &partial,
            plaintext.len() as u64,
            OBJECT_CHUNK_SIZE,
        );
        download_record.direction = ObjectTransferDirection::Download;
        download_record.source_local_ref.clear();
        let store = Arc::new(TestStore::default());
        store.insert(download_record);
        let control = Arc::new(ObjectTransferControl::new());
        control.request_shutdown();
        let worker = ObjectTransferWorker::with_control(
            store,
            Arc::new(MemoryTransport::new()),
            blobs.clone(),
            Arc::new(TestCodec),
            control,
            ObjectRetryPolicy::default(),
        )
        .unwrap();

        assert!(matches!(
            worker
                .run_download_once(
                    "shutdown-download-transfer",
                    &descriptor,
                    &Sha256::digest(&plaintext).into(),
                    &cache,
                    10,
                )
                .unwrap(),
            ObjectTransferProgress::RetryScheduled { .. }
        ));
        assert!(blobs.exists(&partial).unwrap());
        assert!(!blobs.exists(&cache).unwrap());
        assert!(!blobs.exists(&plaintext_staging_ref(&cache)).unwrap());
    }

    #[test]
    fn shutdown_waits_for_active_transfer_permits_to_drain() {
        let control = ObjectTransferControl::new();
        let permit = control.try_admit("active-transfer").unwrap();

        assert!(!control.request_shutdown_and_wait(Duration::from_millis(1)));
        drop(permit);
        assert!(control.request_shutdown_and_wait(Duration::from_millis(1)));
        assert!(control.try_admit("new-transfer").is_err());
    }

    #[test]
    fn transfer_control_admits_each_transfer_once_until_release() {
        let control = ObjectTransferControl::new();
        let first = control.try_admit("transfer-1").unwrap();

        assert!(matches!(
            control.try_admit("transfer-1"),
            Err(AdmissionError::AlreadyActive)
        ));
        let second = control.try_admit("transfer-2").unwrap();
        assert_eq!(control.active.load(Ordering::Acquire), 2);

        drop(first);
        let first_again = control.try_admit("transfer-1").unwrap();
        assert_eq!(control.active.load(Ordering::Acquire), 2);

        drop(first_again);
        drop(second);
        assert_eq!(control.active.load(Ordering::Acquire), 0);
        assert!(control.active_transfer_ids.lock().unwrap().is_empty());
    }

    #[test]
    fn declared_memory_bound_matches_two_chunks_plus_overhead() {
        assert_eq!(
            ObjectTransferWorker::memory_bound(1024 * 1024),
            18 * 1024 * 1024
        );
    }

    #[test]
    fn persisted_numeric_state_contract_remains_stable() {
        assert_eq!(ObjectTransferDirection::Upload as i32, 1);
        assert_eq!(ObjectTransferDirection::Download as i32, 2);
        assert_eq!(ObjectTransferState::Queued as i32, 1);
        assert_eq!(ObjectTransferState::Transferring as i32, 2);
        assert_eq!(ObjectTransferState::Verifying as i32, 3);
        assert_eq!(ObjectTransferState::Complete as i32, 4);
        assert_eq!(ObjectTransferState::RetryWait as i32, 5);
        assert_eq!(ObjectTransferState::Cancelled as i32, 6);
        assert_eq!(ObjectTransferState::Terminal as i32, 7);
        assert_eq!(ObjectTransferErrorCode::UploadExpired as i32, 1);
        assert_eq!(ObjectTransferErrorCode::RetryLater as i32, 8);
    }
}
