use super::attachment::{
    decrypt_attachment_chunk, encrypt_attachment_chunk, validate_encrypted_object_descriptor,
    AttachmentCryptoMaterial, EncryptedAttachmentChunk, ATTACHMENT_TAG_SIZE,
};
use super::{AttachmentTransferRecord, MessagingStore};
use crate::model::chat::{
    AttachmentTransferError, AttachmentTransferErrorCode, AttachmentTransferState,
    BeginAttachmentUploadRequest, BeginAttachmentUploadResponse, CancelAttachmentUploadRequest,
    CancelAttachmentUploadResponse, CompleteAttachmentUploadRequest,
    CompleteAttachmentUploadResponse, CryptoEndpoint, EncryptedObjectDescriptor,
    EncryptedObjectUploadSpec, PutAttachmentChunkRequest,
};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use prost::Message;
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, IF_MATCH, RANGE};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

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
    fn retryable(
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

    fn terminal(code: AttachmentTransferErrorCode, detail: String) -> Self {
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
    pub(crate) fn new() -> Self {
        Self {
            shutdown: AtomicBool::new(false),
            active: AtomicUsize::new(0),
            active_attachment_ids: Mutex::new(HashSet::new()),
        }
    }

    pub(crate) fn request_shutdown(&self) {
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
    store: Arc<MessagingStore>,
    transport: Arc<dyn AttachmentTransferTransport>,
    control: Arc<AttachmentTransferControl>,
    retry_policy: AttachmentRetryPolicy,
}

pub struct StationAttachmentTransferTransport {
    token: String,
    device_id: String,
    endpoint: CryptoEndpoint,
    client: Client,
}

impl StationAttachmentTransferTransport {
    pub fn new(token: String, endpoint: CryptoEndpoint) -> Result<Self, String> {
        if token.trim().is_empty()
            || endpoint.ptid.trim().is_empty()
            || endpoint.device_id.trim().is_empty()
        {
            return Err("messaging attachment transport identity is incomplete".to_string());
        }
        Ok(Self {
            token,
            device_id: endpoint.device_id.clone(),
            endpoint,
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|error| format!("build messaging attachment client: {error}"))?,
        })
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(
                method,
                format!(
                    "{}{}",
                    crate::infrastructure::station_client::station_base_url(),
                    path
                ),
            )
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header("X-Device-ID", &self.device_id)
    }

    fn require_success(
        response: reqwest::blocking::Response,
    ) -> Result<Vec<u8>, AttachmentTransferFailure> {
        let status = response.status();
        let retry_after_ms = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok())
            .map(|seconds| seconds.saturating_mul(1_000));
        let body = response
            .bytes()
            .map_err(|error| transport_error(error.to_string()))?;
        if !status.is_success() {
            if let Some(failure) = decode_typed_transfer_failure(&body, retry_after_ms) {
                return Err(failure);
            }
            let detail = format!("messaging attachment station status {status}");
            return Err(match status.as_u16() {
                401 | 403 => AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::NotGranted,
                    detail,
                ),
                409 => AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::PartConflict,
                    detail,
                ),
                412 => AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    detail,
                ),
                416 => AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::RangeInvalid,
                    detail,
                ),
                429 => AttachmentTransferFailure::retryable(
                    AttachmentTransferErrorCode::QuotaExceeded,
                    retry_after_ms,
                    detail,
                ),
                500..=599 => AttachmentTransferFailure::retryable(
                    AttachmentTransferErrorCode::RetryLater,
                    retry_after_ms,
                    detail,
                ),
                _ => AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    detail,
                ),
            });
        }
        Ok(body.to_vec())
    }
}

fn decode_typed_transfer_failure(
    body: &[u8],
    header_retry_after_ms: Option<i64>,
) -> Option<AttachmentTransferFailure> {
    let typed = AttachmentTransferError::decode(body).ok()?;
    let code = AttachmentTransferErrorCode::try_from(typed.code).ok()?;
    if code == AttachmentTransferErrorCode::Unspecified {
        return None;
    }
    let typed_retry_after_ms = typed.retry_after.and_then(|duration| {
        if duration.seconds < 0 || !(0..1_000_000_000).contains(&duration.nanos) {
            return None;
        }
        duration.seconds.checked_mul(1_000).and_then(|millis| {
            millis.checked_add(i64::from(duration.nanos).saturating_add(999_999) / 1_000_000)
        })
    });
    let detail = format!("messaging attachment station error {}", code.as_str_name());
    Some(
        if matches!(
            code,
            AttachmentTransferErrorCode::QuotaExceeded | AttachmentTransferErrorCode::RetryLater
        ) {
            AttachmentTransferFailure::retryable(
                code,
                typed_retry_after_ms.or(header_retry_after_ms),
                detail,
            )
        } else {
            AttachmentTransferFailure::terminal(code, detail)
        },
    )
}

fn transport_error(detail: String) -> AttachmentTransferFailure {
    AttachmentTransferFailure::retryable(AttachmentTransferErrorCode::RetryLater, None, detail)
}

impl AttachmentTransferTransport for StationAttachmentTransferTransport {
    fn begin_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<(String, u64, Vec<u8>), AttachmentTransferFailure> {
        let mut request = BeginAttachmentUploadRequest {
            conversation_id: transfer.conversation_id.clone(),
            message_id: transfer.message_id.clone(),
            attachment_id: transfer.attachment_id.clone(),
            uploader: Some(self.endpoint.clone()),
            object: Some(prepared.object.clone()),
            descriptor_commitment_sha256: Vec::new(),
            idempotency_key: transfer.attachment_id.clone(),
            authority_station_id: transfer.authority_station_id.clone(),
        };
        request.descriptor_commitment_sha256 = upload_commitment(&request)?;
        let body = Self::require_success(
            self.request(
                reqwest::Method::POST,
                "/conversation/attachments/uploads:begin",
            )
            .header(CONTENT_TYPE, "application/x-protobuf")
            .header(ACCEPT, "application/x-protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(|error| transport_error(error.to_string()))?,
        )?;
        let response = BeginAttachmentUploadResponse::decode(body.as_slice()).map_err(|error| {
            AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                error.to_string(),
            )
        })?;
        if response.authority_station_id != transfer.authority_station_id
            || response.upload_id.trim().is_empty()
            || response.generation == 0
        {
            return Err(AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                "messaging attachment begin response binding mismatch".to_string(),
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
        transfer: &AttachmentTransferRecord,
        chunk: &EncryptedAttachmentChunk,
    ) -> Result<(), AttachmentTransferFailure> {
        let metadata = PutAttachmentChunkRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            chunk_index: chunk.chunk_index,
            byte_offset: u64::from(chunk.chunk_index)
                * u64::from(transfer.chunk_size + ATTACHMENT_TAG_SIZE),
            ciphertext_size: chunk.ciphertext.len() as u64,
            ciphertext_sha256: chunk.ciphertext_sha256.to_vec(),
            idempotency_key: format!("{}:{}", transfer.attachment_id, chunk.chunk_index),
            authority_station_id: transfer.authority_station_id.clone(),
            conversation_id: transfer.conversation_id.clone(),
        };
        Self::require_success(
            self.request(
                reqwest::Method::PUT,
                &format!(
                    "/conversation/attachments/uploads/{}/chunks/{}",
                    transfer.upload_id, chunk.chunk_index
                ),
            )
            .header(CONTENT_TYPE, "application/octet-stream")
            .header(
                "X-Peers-Attachment-Metadata-Bin",
                B64.encode(metadata.encode_to_vec()),
            )
            .body(chunk.ciphertext.clone())
            .send()
            .map_err(|error| transport_error(error.to_string()))?,
        )?;
        Ok(())
    }

    fn complete_upload(
        &self,
        transfer: &AttachmentTransferRecord,
        prepared: &PreparedAttachmentUpload,
    ) -> Result<EncryptedObjectDescriptor, AttachmentTransferFailure> {
        let request = CompleteAttachmentUploadRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            descriptor_commitment_sha256: prepared.descriptor_sha256.to_vec(),
            authority_station_id: transfer.authority_station_id.clone(),
            conversation_id: transfer.conversation_id.clone(),
        };
        let body = Self::require_success(
            self.request(
                reqwest::Method::POST,
                &format!(
                    "/conversation/attachments/uploads/{}/complete",
                    transfer.upload_id
                ),
            )
            .header(CONTENT_TYPE, "application/x-protobuf")
            .header(ACCEPT, "application/x-protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(|error| transport_error(error.to_string()))?,
        )?;
        CompleteAttachmentUploadResponse::decode(body.as_slice())
            .map_err(|error| {
                AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    error.to_string(),
                )
            })?
            .object
            .ok_or_else(|| {
                AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    "messaging attachment completion omitted descriptor".to_string(),
                )
            })
    }

    fn get_download_chunk(
        &self,
        transfer: &AttachmentTransferRecord,
        descriptor: &EncryptedObjectDescriptor,
        _chunk_index: u32,
        start: u64,
        end: u64,
    ) -> Result<Vec<u8>, AttachmentTransferFailure> {
        let mut url = reqwest::Url::parse(&format!(
            "{}/conversation/attachments/objects/{}",
            crate::infrastructure::station_client::station_base_url(),
            descriptor.object_id
        ))
        .map_err(|error| {
            AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                error.to_string(),
            )
        })?;
        url.query_pairs_mut()
            .append_pair("conversation_id", &transfer.conversation_id);
        let response = self
            .client
            .get(url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header("X-Device-ID", &self.device_id)
            .header(
                "X-Peers-Authority-Station-ID",
                &transfer.authority_station_id,
            )
            .header(
                IF_MATCH,
                format!("\"{}\"", hex::encode(&descriptor.ciphertext_sha256)),
            )
            .header(RANGE, format!("bytes={start}-{end}"))
            .send()
            .map_err(|error| transport_error(error.to_string()))?;
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Self::require_success(response).and_then(|_| {
                Err(AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::RangeInvalid,
                    "messaging attachment range response was not partial".to_string(),
                ))
            });
        }
        Self::require_success(response)
    }

    fn cancel_upload(
        &self,
        transfer: &AttachmentTransferRecord,
    ) -> Result<(), AttachmentTransferFailure> {
        let request = CancelAttachmentUploadRequest {
            upload_id: transfer.upload_id.clone(),
            generation: transfer.generation,
            authority_station_id: transfer.authority_station_id.clone(),
            conversation_id: transfer.conversation_id.clone(),
        };
        let body = Self::require_success(
            self.request(
                reqwest::Method::POST,
                &format!(
                    "/conversation/attachments/uploads/{}/cancel",
                    transfer.upload_id
                ),
            )
            .header(CONTENT_TYPE, "application/x-protobuf")
            .header(ACCEPT, "application/x-protobuf")
            .body(request.encode_to_vec())
            .send()
            .map_err(|error| transport_error(error.to_string()))?,
        )?;
        let response =
            CancelAttachmentUploadResponse::decode(body.as_slice()).map_err(|error| {
                AttachmentTransferFailure::terminal(
                    AttachmentTransferErrorCode::DescriptorMismatch,
                    error.to_string(),
                )
            })?;
        if response.state != AttachmentTransferState::Cancelled as i32 {
            return Err(AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::DescriptorMismatch,
                "messaging attachment cancellation state mismatch".to_string(),
            ));
        }
        Ok(())
    }
}

impl AttachmentTransferWorker {
    #[cfg(test)]
    fn new(store: Arc<MessagingStore>, transport: Arc<dyn AttachmentTransferTransport>) -> Self {
        Self::with_control(
            store,
            transport,
            Arc::new(AttachmentTransferControl::new()),
            AttachmentRetryPolicy::default(),
        )
        .expect("default attachment transfer policy must be valid")
    }

    pub(crate) fn with_control(
        store: Arc<MessagingStore>,
        transport: Arc<dyn AttachmentTransferTransport>,
        control: Arc<AttachmentTransferControl>,
        retry_policy: AttachmentRetryPolicy,
    ) -> Result<Self, String> {
        Ok(Self {
            store,
            transport,
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
        cache_path: &Path,
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
            cache_path,
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
            Path::new(&transfer.source_local_ref),
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

        let mut source =
            File::open(&transfer.source_local_ref).map_err(|error| error.to_string())?;
        for chunk_index in 0..material.chunk_count() {
            self.control.check_running()?;
            if chunk_complete(&transfer.completed_chunk_bitmap, chunk_index) {
                continue;
            }
            let plaintext = read_plaintext_chunk(&mut source, &material, chunk_index)?;
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
        cache_path: &Path,
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
            discard_partial(&transfer.partial_local_ref)?;
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
        if cache_path.exists() {
            if (0..descriptor.chunk_count)
                .all(|index| chunk_complete(&transfer.completed_chunk_bitmap, index))
                && sha256_file(cache_path)? == *expected_plaintext_sha256
            {
                self.store
                    .complete_attachment_download(
                        &transfer,
                        descriptor,
                        cache_path.to_str().ok_or_else(|| {
                            integrity_failure(
                                "messaging attachment cache path is invalid".to_string(),
                            )
                        })?,
                        now_unix_ms,
                    )
                    .map_err(store_failure)?;
                return Ok(true);
            }
            fs::remove_file(cache_path).map_err(|error| error.to_string())?;
            return Err(integrity_failure(
                "messaging attachment promoted cache is invalid".to_string(),
            ));
        }
        validate_partial_file(&transfer, &material, descriptor).map_err(integrity_failure)?;

        let partial_path = Path::new(&transfer.partial_local_ref);
        if let Some(parent) = partial_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut partial = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(partial_path)
            .map_err(|error| error.to_string())?;
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
            partial
                .seek(SeekFrom::Start(
                    u64::from(chunk_index) * u64::from(material.chunk_size()),
                ))
                .and_then(|_| partial.write_all(&plaintext))
                .and_then(|_| partial.sync_data())
                .map_err(|error| error.to_string())?;
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
        partial
            .set_len(material.plaintext_size())
            .map_err(|e| e.to_string())?;
        drop(partial);
        if sha256_file(partial_path)? != *expected_plaintext_sha256 {
            discard_partial(&transfer.partial_local_ref)?;
            return Err(integrity_failure(
                "messaging attachment plaintext hash mismatch".to_string(),
            ));
        }
        if let Some(parent) = cache_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(partial_path, cache_path).map_err(|error| error.to_string())?;
        self.store
            .complete_attachment_download(
                &transfer,
                descriptor,
                cache_path.to_str().ok_or_else(|| {
                    integrity_failure("messaging attachment cache path is invalid".to_string())
                })?,
                now_unix_ms,
            )
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
        discard_partial(&transfer.partial_local_ref)?;
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
    path: &Path,
    material: &AttachmentCryptoMaterial,
    transfer: &AttachmentTransferRecord,
    media_type: &str,
) -> Result<PreparedAttachmentUpload, String> {
    if media_type.trim().is_empty() || media_type.len() > 255 {
        return Err("messaging attachment media type is invalid".to_string());
    }
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() != material.plaintext_size() {
        return Err("messaging attachment source size changed".to_string());
    }
    let mut source = File::open(path).map_err(|error| error.to_string())?;
    let mut whole = Sha256::new();
    let mut chunk_hashes = Vec::with_capacity(material.chunk_count() as usize);
    let mut ciphertext_size = 0_u64;
    for chunk_index in 0..material.chunk_count() {
        let plaintext = read_plaintext_chunk(&mut source, material, chunk_index)?;
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
        encryption_suite: crate::model::chat::AttachmentEncryptionSuite::Aes256GcmChunked as i32,
        tag_size: ATTACHMENT_TAG_SIZE,
        nonce_strategy: crate::model::chat::AttachmentNonceStrategy::Counter32Be as i32,
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
    path: &Path,
    material: &AttachmentCryptoMaterial,
    transfer: &AttachmentTransferRecord,
) -> Result<PreparedAttachmentUpload, String> {
    prepare_upload_with_media_type(path, material, transfer, "application/octet-stream")
}

fn upload_commitment(request: &BeginAttachmentUploadRequest) -> Result<Vec<u8>, String> {
    let object = request
        .object
        .as_ref()
        .ok_or_else(|| "messaging attachment upload object is required".to_string())?;
    Ok(upload_commitment_fields(
        &request.conversation_id,
        &request.message_id,
        &request.attachment_id,
        &request.authority_station_id,
        object,
    )
    .to_vec())
}

pub(super) fn upload_commitment_fields(
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
    file: &mut File,
    material: &AttachmentCryptoMaterial,
    index: u32,
) -> Result<Vec<u8>, String> {
    let size = plaintext_chunk_size(material, index)?;
    let mut bytes = vec![0; size];
    file.seek(SeekFrom::Start(
        u64::from(index) * u64::from(material.chunk_size()),
    ))
    .and_then(|_| file.read_exact(&mut bytes))
    .map_err(|error| error.to_string())?;
    Ok(bytes)
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

fn validate_partial_file(
    transfer: &AttachmentTransferRecord,
    material: &AttachmentCryptoMaterial,
    descriptor: &EncryptedObjectDescriptor,
) -> Result<(), String> {
    let path = Path::new(&transfer.partial_local_ref);
    if !path.exists() {
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
    if fs::metadata(path).map_err(|e| e.to_string())?.len() < expected_min {
        discard_partial(&transfer.partial_local_ref)?;
        return Err("messaging attachment partial file checkpoint mismatch".to_string());
    }
    let mut partial = File::open(path).map_err(|error| error.to_string())?;
    for chunk_index in 0..material.chunk_count() {
        if !chunk_complete(&transfer.completed_chunk_bitmap, chunk_index) {
            continue;
        }
        let plaintext = read_plaintext_chunk(&mut partial, material, chunk_index)?;
        let encrypted = encrypt_attachment_chunk(material, chunk_index, &plaintext)?;
        if descriptor.chunk_ciphertext_sha256[chunk_index as usize] != encrypted.ciphertext_sha256 {
            drop(partial);
            discard_partial(&transfer.partial_local_ref)?;
            return Err("messaging attachment partial file integrity mismatch".to_string());
        }
    }
    Ok(())
}

fn discard_partial(path: &str) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn sha256_file(path: &Path) -> Result<[u8; 32], String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hash.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use ulid::Ulid;

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
                return Err(transport_error("injected upload interruption".to_string()));
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
                return Err(transport_error(
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

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("pt-attachment-{label}-{}", Ulid::new()))
    }

    fn transfer(
        attachment_id: &str,
        source: &Path,
        partial: &Path,
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
            source_local_ref: source.display().to_string(),
            partial_local_ref: partial.display().to_string(),
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
        let source = temp_path("upload-source");
        let partial = temp_path("upload-partial");
        let plaintext = (0..(2 * 1024 * 1024 + 41))
            .map(|value| value as u8)
            .collect::<Vec<_>>();
        fs::write(&source, &plaintext).unwrap();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
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
        let worker = AttachmentTransferWorker::new(store.clone(), transport.clone());

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
        let _ = fs::remove_file(source);
    }

    #[test]
    fn upload_resumes_after_interruption_at_every_chunk() {
        let source = temp_path("upload-every-chunk-source");
        let partial = temp_path("upload-every-chunk-partial");
        let plaintext = vec![37_u8; 2 * 1024 * 1024 + 41];
        fs::write(&source, &plaintext).unwrap();

        for interrupted_chunk in 0..3 {
            let attachment_id = format!("upload-every-chunk-{interrupted_chunk}");
            let store = Arc::new(MessagingStore::in_memory().unwrap());
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
            let worker = AttachmentTransferWorker::new(store.clone(), transport.clone());

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
        let _ = fs::remove_file(source);
    }

    #[test]
    fn download_resumes_then_atomically_promotes_verified_plaintext() {
        let source = temp_path("download-source");
        let partial = temp_path("download-partial");
        let cache = temp_path("download-cache");
        let plaintext = (0..(2 * 1024 * 1024 + 41))
            .map(|value| (value * 3) as u8)
            .collect::<Vec<_>>();
        fs::write(&source, &plaintext).unwrap();
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
        let prepared = prepare_upload(&source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        for index in 0..material.chunk_count() {
            let mut file = File::open(&source).unwrap();
            let chunk = read_plaintext_chunk(&mut file, &material, index).unwrap();
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
        let store = Arc::new(MessagingStore::in_memory().unwrap());
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
        let worker = AttachmentTransferWorker::new(store.clone(), transport.clone());

        assert!(worker
            .download_once(
                "download-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                10,
            )
            .is_err());
        assert!(partial.exists());
        assert!(!cache.exists());
        worker
            .download_once(
                "download-transfer",
                &descriptor,
                &plaintext_hash,
                &cache,
                11,
            )
            .unwrap();
        assert_eq!(fs::read(&cache).unwrap(), plaintext);
        assert!(!partial.exists());
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(cache);
    }

    #[test]
    fn download_resumes_after_interruption_at_every_chunk() {
        let source = temp_path("download-every-chunk-source");
        let plaintext = vec![53_u8; 2 * 1024 * 1024 + 41];
        fs::write(&source, &plaintext).unwrap();
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
            &temp_path("download-every-chunk-unused"),
            plaintext.len() as u64,
            1024 * 1024,
        );
        let prepared = prepare_upload(&source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        for chunk_index in 0..material.chunk_count() {
            let mut file = File::open(&source).unwrap();
            let plaintext_chunk = read_plaintext_chunk(&mut file, &material, chunk_index).unwrap();
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
            let partial = temp_path(&format!("download-every-chunk-partial-{interrupted_chunk}"));
            let cache = temp_path(&format!("download-every-chunk-cache-{interrupted_chunk}"));
            let store = Arc::new(MessagingStore::in_memory().unwrap());
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
            let worker = AttachmentTransferWorker::new(store.clone(), transport.clone());

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
            assert_eq!(fs::read(&cache).unwrap(), plaintext);
            assert!(!partial.exists());
            let _ = fs::remove_file(cache);
        }
        let _ = fs::remove_file(source);
    }

    #[test]
    fn partial_checkpoint_mismatch_is_deleted_and_fails_closed() {
        let source = temp_path("mismatch-source");
        let partial = temp_path("mismatch-partial");
        let cache = temp_path("mismatch-cache");
        fs::write(&source, vec![1_u8; 1024 * 1024 + 17]).unwrap();
        fs::write(&partial, [1_u8; 2]).unwrap();
        let material =
            AttachmentCryptoMaterial::from_parts([7; 32], [0; 12], 1024 * 1024 + 17, 1024 * 1024)
                .unwrap();
        let upload_record = transfer("unused", &source, &partial, 1024 * 1024 + 17, 1024 * 1024);
        let prepared = prepare_upload(&source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
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
        let worker = AttachmentTransferWorker::new(store, transport);
        assert!(worker
            .download_once("mismatch-transfer", &descriptor, &[0; 32], &cache, 10)
            .is_err());
        assert!(!partial.exists());
        let _ = fs::remove_file(source);
    }

    #[test]
    fn same_length_partial_corruption_is_deleted_and_fails_closed() {
        let source = temp_path("corrupt-partial-source");
        let partial = temp_path("corrupt-partial");
        let cache = temp_path("corrupt-partial-cache");
        let plaintext = vec![7_u8; 2 * 1024 * 1024 + 17];
        fs::write(&source, &plaintext).unwrap();
        fs::write(&partial, vec![9_u8; 1024 * 1024]).unwrap();
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
        let prepared = prepare_upload(&source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        let descriptor = transport
            .complete_upload(&upload_record, &prepared)
            .unwrap();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
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

        let worker = AttachmentTransferWorker::new(store, transport);
        assert!(worker
            .download_once(
                "corrupt-partial-transfer",
                &descriptor,
                &Sha256::digest(&plaintext).into(),
                &cache,
                10,
            )
            .is_err());
        assert!(!partial.exists());
        assert!(!cache.exists());
        let _ = fs::remove_file(source);
    }

    #[test]
    fn corrupt_download_chunk_and_wrong_etag_fail_closed() {
        let source = temp_path("corrupt-download-source");
        let partial = temp_path("corrupt-download-partial");
        let cache = temp_path("corrupt-download-cache");
        let plaintext = vec![5_u8; 1024 * 1024 + 17];
        fs::write(&source, &plaintext).unwrap();
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
        let prepared = prepare_upload(&source, &material, &upload_record).unwrap();
        let transport = Arc::new(MemoryTransport::new());
        for index in 0..material.chunk_count() {
            let mut file = File::open(&source).unwrap();
            let chunk = read_plaintext_chunk(&mut file, &material, index).unwrap();
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
        let store = Arc::new(MessagingStore::in_memory().unwrap());
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
        let worker = AttachmentTransferWorker::new(store, transport.clone());

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
        assert!(!cache.exists());

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
        assert!(!cache.exists());
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(partial);
    }

    #[test]
    fn hundred_mib_upload_resumes_at_quarter_boundaries() {
        const SIZE: u64 = 100 * 1024 * 1024;
        const CHUNKS: u32 = 100;
        let source = temp_path("hundred-mib-source");
        let partial = temp_path("hundred-mib-partial");
        let file = File::create(&source).unwrap();
        file.set_len(SIZE).unwrap();

        for completed_chunks in [25_u32, 50, 75] {
            let attachment_id = format!("hundred-mib-{completed_chunks}");
            let store = Arc::new(MessagingStore::in_memory().unwrap());
            let mut record = transfer(&attachment_id, &source, &partial, SIZE, 1024 * 1024);
            record.upload_id = format!("upload-{completed_chunks}");
            record.generation = 1;
            for index in 0..completed_chunks {
                set_chunk_complete(&mut record.completed_chunk_bitmap, index);
            }
            store.create_attachment_transfer(&record).unwrap();
            let transport = Arc::new(MemoryTransport::without_upload_retention());
            let worker = AttachmentTransferWorker::new(store.clone(), transport.clone());

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
        let _ = fs::remove_file(source);
    }

    #[test]
    fn hundred_mib_download_resumes_at_quarter_boundaries() {
        const SIZE: u64 = 100 * 1024 * 1024;
        const CHUNKS: u32 = 100;
        let source = temp_path("hundred-mib-download-source");
        let source_file = File::create(&source).unwrap();
        source_file.set_len(SIZE).unwrap();
        let material =
            AttachmentCryptoMaterial::from_parts([7; 32], [0; 12], SIZE, 1024 * 1024).unwrap();
        let descriptor_record = transfer(
            "descriptor",
            &source,
            &temp_path("descriptor-partial"),
            SIZE,
            1024 * 1024,
        );
        let prepared = prepare_upload(&source, &material, &descriptor_record).unwrap();
        let descriptor = MemoryTransport::new()
            .complete_upload(&descriptor_record, &prepared)
            .unwrap();
        let plaintext_hash = sha256_file(&source).unwrap();

        for completed_chunks in [25_u32, 50, 75] {
            let attachment_id = format!("hundred-mib-download-{completed_chunks}");
            let partial = temp_path(&format!("hundred-mib-download-partial-{completed_chunks}"));
            let cache = temp_path(&format!("hundred-mib-download-cache-{completed_chunks}"));
            let partial_file = File::create(&partial).unwrap();
            partial_file
                .set_len(u64::from(completed_chunks) * 1024 * 1024)
                .unwrap();
            let store = Arc::new(MessagingStore::in_memory().unwrap());
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
            let worker = AttachmentTransferWorker::new(store, transport.clone());

            worker
                .download_once(&attachment_id, &descriptor, &plaintext_hash, &cache, 10)
                .unwrap();

            let calls = transport.download_calls.lock().unwrap();
            assert_eq!(calls.len(), (CHUNKS - completed_chunks) as usize);
            assert_eq!(calls.first().copied(), Some(completed_chunks));
            assert_eq!(calls.last().copied(), Some(CHUNKS - 1));
            assert_eq!(sha256_file(&cache).unwrap(), plaintext_hash);
            assert!(!partial.exists());
            let _ = fs::remove_file(cache);
        }
        let _ = fs::remove_file(source);
    }

    #[test]
    fn explicit_cancel_aborts_remote_session_and_persists_terminal_state() {
        let source = temp_path("cancel-source");
        let partial = temp_path("cancel-partial");
        fs::write(&source, vec![1_u8; 1024 * 1024]).unwrap();
        fs::write(&partial, vec![2_u8; 1024]).unwrap();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
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
        let worker = AttachmentTransferWorker::new(store.clone(), transport.clone());

        worker.cancel("cancel-transfer", 10).unwrap();
        worker.cancel("cancel-transfer", 11).unwrap();

        assert_eq!(*transport.cancel_calls.lock().unwrap(), 1);
        assert!(!partial.exists());
        assert_eq!(
            store
                .attachment_transfer("cancel-transfer")
                .unwrap()
                .unwrap()
                .state,
            AttachmentTransferState::Cancelled as i32
        );
        let _ = fs::remove_file(source);
    }

    #[test]
    fn retryable_failure_persists_jittered_backoff_and_respects_due_time() {
        let source = temp_path("retry-source");
        let partial = temp_path("retry-partial");
        fs::write(&source, vec![3_u8; 1024 * 1024]).unwrap();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
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
        let worker = AttachmentTransferWorker::new(store.clone(), transport.clone());

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
        let _ = fs::remove_file(source);
    }

    #[test]
    fn integrity_failure_is_terminal_and_not_retried() {
        let source = temp_path("terminal-source");
        let partial = temp_path("terminal-partial");
        fs::write(&source, [1_u8]).unwrap();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let record = transfer(
            "terminal-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        );
        store.create_attachment_transfer(&record).unwrap();
        let worker = AttachmentTransferWorker::new(store.clone(), Arc::new(MemoryTransport::new()));

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
        let _ = fs::remove_file(source);
    }

    #[test]
    fn canonical_station_error_body_overrides_http_fallback() {
        let retry_later = AttachmentTransferError {
            code: AttachmentTransferErrorCode::RetryLater as i32,
            retry_after: Some(prost_types::Duration {
                seconds: 1,
                nanos: 250_000_000,
            }),
        }
        .encode_to_vec();
        assert_eq!(
            decode_typed_transfer_failure(&retry_later, Some(5_000)),
            Some(AttachmentTransferFailure::retryable(
                AttachmentTransferErrorCode::RetryLater,
                Some(1_250),
                "messaging attachment station error ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER"
                    .to_string(),
            ))
        );

        let conflict = AttachmentTransferError {
            code: AttachmentTransferErrorCode::PartConflict as i32,
            retry_after: None,
        }
        .encode_to_vec();
        assert_eq!(
            decode_typed_transfer_failure(&conflict, None),
            Some(AttachmentTransferFailure::terminal(
                AttachmentTransferErrorCode::PartConflict,
                "messaging attachment station error ATTACHMENT_TRANSFER_ERROR_CODE_PART_CONFLICT"
                    .to_string(),
            ))
        );
        let invalid_duration = AttachmentTransferError {
            code: AttachmentTransferErrorCode::RetryLater as i32,
            retry_after: Some(prost_types::Duration {
                seconds: 1,
                nanos: 1_000_000_000,
            }),
        }
        .encode_to_vec();
        assert_eq!(
            decode_typed_transfer_failure(&invalid_duration, Some(5_000)),
            Some(AttachmentTransferFailure::retryable(
                AttachmentTransferErrorCode::RetryLater,
                Some(5_000),
                "messaging attachment station error ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER"
                    .to_string(),
            ))
        );
        assert_eq!(decode_typed_transfer_failure(b"not protobuf", None), None);
    }

    #[test]
    fn server_retry_after_takes_precedence_and_remains_capped() {
        let source = temp_path("retry-after-source");
        let partial = temp_path("retry-after-partial");
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let record = transfer(
            "retry-after-transfer",
            &source,
            &partial,
            1024 * 1024,
            1024 * 1024,
        );
        store.create_attachment_transfer(&record).unwrap();
        let worker = AttachmentTransferWorker::new(store.clone(), Arc::new(MemoryTransport::new()));

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
        let source = temp_path("bounded-source");
        let partial = temp_path("bounded-partial");
        fs::write(&source, vec![4_u8; 1024 * 1024]).unwrap();
        let control = Arc::new(AttachmentTransferControl::new());
        let permits = (0..ATTACHMENT_MAX_ACTIVE_TRANSFERS)
            .map(|index| control.try_admit(&format!("active-{index}")).unwrap())
            .collect::<Vec<_>>();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
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
        let _ = fs::remove_file(source);
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
    #[ignore = "requires a native Desktop profile, session file, and live Station"]
    fn live_engine_worker_uploads_through_station_transport() {
        #[derive(serde::Deserialize)]
        struct NativeSession {
            actor_ptid: String,
            token: String,
        }

        struct FailBeforeSecondChunk {
            inner: StationAttachmentTransferTransport,
        }

        impl AttachmentTransferTransport for FailBeforeSecondChunk {
            fn begin_upload(
                &self,
                transfer: &AttachmentTransferRecord,
                prepared: &PreparedAttachmentUpload,
            ) -> Result<(String, u64, Vec<u8>), AttachmentTransferFailure> {
                self.inner.begin_upload(transfer, prepared)
            }

            fn put_upload_chunk(
                &self,
                transfer: &AttachmentTransferRecord,
                chunk: &EncryptedAttachmentChunk,
            ) -> Result<(), AttachmentTransferFailure> {
                if chunk.chunk_index == 1 {
                    return Err(AttachmentTransferFailure::retryable(
                        AttachmentTransferErrorCode::RetryLater,
                        None,
                        "injected process interruption before chunk 1".to_string(),
                    ));
                }
                self.inner.put_upload_chunk(transfer, chunk)
            }

            fn complete_upload(
                &self,
                transfer: &AttachmentTransferRecord,
                prepared: &PreparedAttachmentUpload,
            ) -> Result<EncryptedObjectDescriptor, AttachmentTransferFailure> {
                self.inner.complete_upload(transfer, prepared)
            }

            fn get_download_chunk(
                &self,
                transfer: &AttachmentTransferRecord,
                descriptor: &EncryptedObjectDescriptor,
                chunk_index: u32,
                start: u64,
                end: u64,
            ) -> Result<Vec<u8>, AttachmentTransferFailure> {
                self.inner
                    .get_download_chunk(transfer, descriptor, chunk_index, start, end)
            }

            fn cancel_upload(
                &self,
                transfer: &AttachmentTransferRecord,
            ) -> Result<(), AttachmentTransferFailure> {
                self.inner.cancel_upload(transfer)
            }
        }

        let profile_id = std::env::var("MESSAGING_ATTACHMENT_ENGINE_PROFILE_ID")
            .expect("MESSAGING_ATTACHMENT_ENGINE_PROFILE_ID is required");
        let ptid = std::env::var("MESSAGING_ATTACHMENT_PTID")
            .expect("MESSAGING_ATTACHMENT_PTID is required");
        let device_id = std::env::var("MESSAGING_ATTACHMENT_DEVICE_ID")
            .expect("MESSAGING_ATTACHMENT_DEVICE_ID is required");
        let token_file = std::env::var("MESSAGING_ATTACHMENT_TOKEN_FILE")
            .expect("MESSAGING_ATTACHMENT_TOKEN_FILE is required");
        let expected_station_url =
            std::env::var("PEERS_STATION_URL").expect("PEERS_STATION_URL is required");
        assert_eq!(
            crate::infrastructure::station_client::station_base_url(),
            expected_station_url.trim_end_matches('/'),
            "live attachment gate resolved a different active Station"
        );
        let session: NativeSession = serde_json::from_slice(
            &fs::read(token_file).expect("native Desktop session file must be readable"),
        )
        .expect("native Desktop session file must be valid");
        assert!(!session.token.trim().is_empty());
        assert_eq!(
            session.actor_ptid, ptid,
            "native session actor must match the requested attachment actor"
        );
        assert!(
            profile_id.ends_with(&session.actor_ptid),
            "native session actor must match the Engine profile"
        );

        let explicit_route = std::env::var("MESSAGING_ATTACHMENT_CONVERSATION_ID")
            .ok()
            .zip(std::env::var("MESSAGING_ATTACHMENT_AUTHORITY_STATION_ID").ok());
        let projection = if explicit_route.is_some() {
            None
        } else {
            let profile_store = MessagingStore::open(&profile_id).unwrap();
            if let Some(enrollment) = profile_store.device_enrollment().unwrap() {
                assert_eq!(enrollment.certificate.ptid, ptid);
                assert_eq!(enrollment.certificate.device_id, device_id);
            }
            let projection = profile_store
                .conversation_projections()
                .unwrap()
                .into_iter()
                .find(|projection| {
                    projection.active && !projection.authority_station_id.is_empty()
                });
            drop(profile_store);
            projection
        };
        if let Some(projection) = &projection {
            assert!(
                projection.members.iter().any(|member| member.ptid == ptid),
                "native endpoint must be an active conversation member"
            );
        }

        let endpoint = crate::messaging::EngineEndpoint {
            ptid: ptid.clone(),
            device_id: device_id.clone(),
        };
        let restart_phase = std::env::var("MESSAGING_ATTACHMENT_RESTART_PHASE").ok();
        let engine = match restart_phase.as_deref() {
            Some("prepare" | "resume") => {
                crate::messaging::MessagingEngine::open(profile_id.clone(), endpoint.clone())
                    .unwrap()
            }
            Some(phase) => panic!("unsupported attachment restart phase: {phase}"),
            None => crate::messaging::MessagingEngine::in_memory(
                format!("attachment-live-{}", Ulid::new()),
                endpoint.clone(),
            )
            .unwrap(),
        };
        let (conversation_id, authority_station_id) = match (explicit_route, projection) {
            (Some(route), _) => route,
            (None, Some(projection)) => {
                (projection.conversation_id, projection.authority_station_id)
            }
            (None, None) => {
                use crate::model::chat::{
                    ListMessagingConversationsRequest, ListMessagingConversationsResponse,
                };
                use reqwest::Method;

                let peer_ptid = std::env::var("MESSAGING_ATTACHMENT_PEER_PTID")
                    .expect("MESSAGING_ATTACHMENT_PEER_PTID is required without a local route");
                let conversation_id = engine
                    .create_direct_conversation(&session.token, &peer_ptid)
                    .unwrap();
                let response = crate::infrastructure::station_client::request_proto_for_device::<
                    ListMessagingConversationsRequest,
                    ListMessagingConversationsResponse,
                >(
                    Method::GET,
                    "/conversation/list",
                    &session.token,
                    None,
                    None::<&ListMessagingConversationsRequest>,
                    &device_id,
                )
                .unwrap();
                let authority_station_id = response
                    .conversations
                    .into_iter()
                    .find(|conversation| conversation.conversation_id == conversation_id)
                    .map(|conversation| conversation.authority_station_id)
                    .filter(|authority| !authority.is_empty())
                    .expect("created conversation must expose its Authority Station");
                (conversation_id, authority_station_id)
            }
        };
        let source = match restart_phase.as_deref() {
            Some(_) => std::env::var("MESSAGING_ATTACHMENT_SOURCE_FILE")
                .map(std::path::PathBuf::from)
                .expect("MESSAGING_ATTACHMENT_SOURCE_FILE is required for restart evidence"),
            None => temp_path("live-engine-source"),
        };
        let partial = temp_path("live-engine-partial");
        let plaintext = vec![11_u8; 1024 * 1024 + 41];
        fs::write(&source, &plaintext).unwrap();
        let attachment_id = match restart_phase.as_deref() {
            Some(_) => std::env::var("MESSAGING_ATTACHMENT_ID")
                .expect("MESSAGING_ATTACHMENT_ID is required for restart evidence"),
            None => Ulid::new().to_string(),
        };
        let record = AttachmentTransferRecord {
            attachment_id: attachment_id.clone(),
            conversation_id,
            message_id: Ulid::new().to_string(),
            authority_station_id,
            direction: 1,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: source.display().to_string(),
            partial_local_ref: partial.display().to_string(),
            object_key: vec![19; 32],
            base_nonce: vec![0; 12],
            plaintext_size: plaintext.len() as u64,
            chunk_size: 1024 * 1024,
            attempt_count: 0,
            next_attempt_at_unix_ms: 1,
            last_error_code: 0,
            updated_at_unix_ms: 1,
        };
        if engine
            .store()
            .attachment_transfer(&attachment_id)
            .unwrap()
            .is_none()
        {
            engine.store().create_attachment_transfer(&record).unwrap();
        }
        let worker = match restart_phase.as_deref() {
            Some("prepare") => AttachmentTransferWorker::new(
                Arc::new(MessagingStore::open(&profile_id).unwrap()),
                Arc::new(FailBeforeSecondChunk {
                    inner: StationAttachmentTransferTransport::new(
                        session.token,
                        CryptoEndpoint { ptid, device_id },
                    )
                    .unwrap(),
                }),
            ),
            _ => engine.attachment_transfer_worker(session.token).unwrap(),
        };

        let now_unix_ms = if restart_phase.as_deref() == Some("resume") {
            1_000_000
        } else {
            20_000
        };
        let progress = worker.run_upload_once(&attachment_id, now_unix_ms).unwrap();
        let persisted = engine
            .store()
            .attachment_transfer(&attachment_id)
            .unwrap()
            .unwrap();
        if restart_phase.as_deref() == Some("prepare") {
            assert!(matches!(
                progress,
                AttachmentTransferProgress::RetryScheduled { .. }
            ), "restart preparation progress={progress:?} state={} error_code={} bitmap={:?} has_upload_id={}",
                persisted.state,
                persisted.last_error_code,
                persisted.completed_chunk_bitmap,
                !persisted.upload_id.is_empty(),
            );
            assert_eq!(persisted.state, AttachmentTransferState::RetryWait as i32);
            assert_eq!(persisted.completed_chunk_bitmap, vec![1]);
            assert!(!persisted.upload_id.is_empty());
            return;
        }
        assert_eq!(progress, AttachmentTransferProgress::Complete);
        assert_eq!(persisted.state, AttachmentTransferState::Complete as i32);
        assert_eq!(persisted.completed_chunk_bitmap, vec![3]);
        assert!(!persisted.upload_id.is_empty());
        let _ = fs::remove_file(source);
    }

    #[test]
    fn declared_memory_bound_matches_two_chunks_plus_overhead() {
        assert_eq!(
            AttachmentTransferWorker::memory_bound(1024 * 1024),
            18 * 1024 * 1024
        );
    }
}
