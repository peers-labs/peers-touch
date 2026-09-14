use std::sync::Arc;

use prost::Message;
use secure_content_core::object::{
    EncryptedObjectChunk, ObjectDescriptor, ObjectRetryPolicy, ObjectTransferControl,
    ObjectTransferErrorCode, ObjectTransferFailure, ObjectTransferProgress, ObjectTransferRecord,
    ObjectTransferState, ObjectTransferWorker, ObjectUploadSpec, PreparedObjectUpload,
    OBJECT_TRANSFER_MEMORY_OVERHEAD,
};
use secure_content_core::ports::{
    ObjectBlob, ObjectCommitmentCodec, ObjectTransferRepository, ObjectTransferTransport,
};
use sha2::{Digest, Sha256};

use crate::proto::chat::{
    AttachmentTransferErrorCode, EncryptedObjectDescriptor, EncryptedObjectUploadSpec,
};

use super::mapping::{
    chat_descriptor_to_core, chat_failure_to_core, chat_transfer_record_to_core,
    core_descriptor_to_chat, core_error_to_chat, core_failure_to_chat, core_state_to_chat,
    core_transfer_record_to_chat, core_upload_spec_to_chat,
    validate_chat_attachment_transfer_record,
};

pub const ATTACHMENT_TRANSFER_MEMORY_OVERHEAD: usize = OBJECT_TRANSFER_MEMORY_OVERHEAD;

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
        detail: impl Into<String>,
    ) -> Self {
        Self {
            code,
            retry_after_ms,
            retryable: true,
            detail: detail.into(),
        }
    }

    pub fn terminal(code: AttachmentTransferErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            retry_after_ms: None,
            retryable: false,
            detail: detail.into(),
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

impl From<AttachmentRetryPolicy> for ObjectRetryPolicy {
    fn from(value: AttachmentRetryPolicy) -> Self {
        Self {
            initial_delay_ms: value.initial_delay_ms,
            maximum_delay_ms: value.maximum_delay_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachmentTransferProgress {
    Complete,
    Deferred { next_attempt_at_unix_ms: i64 },
    RetryScheduled { next_attempt_at_unix_ms: i64 },
    Terminal { code: AttachmentTransferErrorCode },
}

impl From<ObjectTransferProgress> for AttachmentTransferProgress {
    fn from(value: ObjectTransferProgress) -> Self {
        match value {
            ObjectTransferProgress::Complete => Self::Complete,
            ObjectTransferProgress::Deferred {
                next_attempt_at_unix_ms,
            } => Self::Deferred {
                next_attempt_at_unix_ms,
            },
            ObjectTransferProgress::RetryScheduled {
                next_attempt_at_unix_ms,
            } => Self::RetryScheduled {
                next_attempt_at_unix_ms,
            },
            ObjectTransferProgress::Terminal { code } => Self::Terminal {
                code: core_error_to_chat(code),
            },
        }
    }
}

pub struct AttachmentTransferControl {
    inner: Arc<ObjectTransferControl>,
}

impl AttachmentTransferControl {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ObjectTransferControl::new()),
        }
    }

    pub fn request_shutdown(&self) {
        self.inner.request_shutdown();
    }
}

impl Default for AttachmentTransferControl {
    fn default() -> Self {
        Self::new()
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

    fn terminalize_attachment_transfer(
        &self,
        attachment_id: &str,
        attempt_count: u32,
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
        chunk: &EncryptedObjectChunk,
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

struct RepositoryAdapter {
    inner: Arc<dyn AttachmentTransferRepository>,
}

impl ObjectTransferRepository for RepositoryAdapter {
    fn object_transfer(
        &self,
        transfer_id: &str,
    ) -> Result<Option<ObjectTransferRecord>, ObjectTransferFailure> {
        self.inner
            .attachment_transfer(transfer_id)
            .map_err(repository_failure)?
            .map(|record| chat_transfer_record_to_core(&record).map_err(integrity_failure))
            .transpose()
    }

    fn upload_media_type(
        &self,
        transfer_id: &str,
    ) -> Result<Option<String>, ObjectTransferFailure> {
        self.inner
            .attachment_upload_media_type(transfer_id)
            .map(Some)
            .map_err(repository_failure)
    }

    fn update_transfer_prepared(
        &self,
        transfer_id: &str,
        descriptor_sha256: &[u8],
        partial_local_ref: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure> {
        self.inner
            .update_attachment_transfer_prepared(
                transfer_id,
                descriptor_sha256,
                partial_local_ref,
                updated_at_unix_ms,
            )
            .map_err(repository_failure)
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
        self.inner
            .update_attachment_transfer_progress(
                transfer_id,
                core_state_to_chat(state) as i32,
                upload_id,
                generation,
                completed_chunk_bitmap,
                attempt_count,
                next_attempt_at_unix_ms,
                last_error.map_or(0, |code| core_error_to_chat(code) as i32),
                updated_at_unix_ms,
            )
            .map_err(repository_failure)
    }

    fn complete_upload(
        &self,
        transfer: &ObjectTransferRecord,
        descriptor: &ObjectDescriptor,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure> {
        self.inner
            .complete_attachment_upload(
                &core_transfer_record_to_chat(transfer),
                &core_descriptor_to_chat(descriptor).map_err(integrity_failure)?,
                updated_at_unix_ms,
            )
            .map_err(repository_failure)
    }

    fn complete_download(
        &self,
        transfer: &ObjectTransferRecord,
        descriptor: &ObjectDescriptor,
        cache_path: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure> {
        self.inner
            .complete_attachment_download(
                &core_transfer_record_to_chat(transfer),
                &core_descriptor_to_chat(descriptor).map_err(integrity_failure)?,
                cache_path,
                updated_at_unix_ms,
            )
            .map_err(repository_failure)
    }
}

struct TransportAdapter {
    inner: Arc<dyn AttachmentTransferTransport>,
}

impl ObjectTransferTransport for TransportAdapter {
    fn begin_upload(
        &self,
        transfer: &ObjectTransferRecord,
        prepared: &PreparedObjectUpload,
    ) -> Result<(String, u64, Vec<u8>), ObjectTransferFailure> {
        self.inner
            .begin_upload(
                &core_transfer_record_to_chat(transfer),
                &PreparedAttachmentUpload {
                    object: core_upload_spec_to_chat(&prepared.object)
                        .map_err(integrity_failure)?,
                    descriptor_sha256: prepared.descriptor_sha256,
                },
            )
            .map_err(chat_failure_to_core)
    }

    fn put_upload_chunk(
        &self,
        transfer: &ObjectTransferRecord,
        chunk: &EncryptedObjectChunk,
    ) -> Result<(), ObjectTransferFailure> {
        self.inner
            .put_upload_chunk(&core_transfer_record_to_chat(transfer), chunk)
            .map_err(chat_failure_to_core)
    }

    fn complete_upload(
        &self,
        transfer: &ObjectTransferRecord,
        prepared: &PreparedObjectUpload,
    ) -> Result<ObjectDescriptor, ObjectTransferFailure> {
        self.inner
            .complete_upload(
                &core_transfer_record_to_chat(transfer),
                &PreparedAttachmentUpload {
                    object: core_upload_spec_to_chat(&prepared.object)
                        .map_err(integrity_failure)?,
                    descriptor_sha256: prepared.descriptor_sha256,
                },
            )
            .map_err(chat_failure_to_core)
            .and_then(|descriptor| chat_descriptor_to_core(&descriptor).map_err(integrity_failure))
    }

    fn get_download_chunk(
        &self,
        transfer: &ObjectTransferRecord,
        descriptor: &ObjectDescriptor,
        chunk_index: u32,
        start: u64,
        end: u64,
    ) -> Result<Vec<u8>, ObjectTransferFailure> {
        self.inner
            .get_download_chunk(
                &core_transfer_record_to_chat(transfer),
                &core_descriptor_to_chat(descriptor).map_err(integrity_failure)?,
                chunk_index,
                start,
                end,
            )
            .map_err(chat_failure_to_core)
    }

    fn cancel_upload(&self, transfer: &ObjectTransferRecord) -> Result<(), ObjectTransferFailure> {
        self.inner
            .cancel_upload(&core_transfer_record_to_chat(transfer))
            .map_err(chat_failure_to_core)
    }
}

struct ChatCommitmentCodec;

impl ObjectCommitmentCodec for ChatCommitmentCodec {
    fn upload_commitment(
        &self,
        transfer: &ObjectTransferRecord,
        object: &ObjectUploadSpec,
    ) -> Result<[u8; 32], ObjectTransferFailure> {
        Ok(upload_commitment_fields(
            &transfer.owner_scope_id,
            &transfer.operation_id,
            &transfer.transfer_id,
            &transfer.authority_id,
            &core_upload_spec_to_chat(object).map_err(integrity_failure)?,
        ))
    }

    fn descriptor_commitment(
        &self,
        descriptor: &ObjectDescriptor,
    ) -> Result<[u8; 32], ObjectTransferFailure> {
        let descriptor = core_descriptor_to_chat(descriptor).map_err(integrity_failure)?;
        Ok(Sha256::digest(descriptor.encode_to_vec()).into())
    }
}

pub struct AttachmentTransferWorker {
    inner: ObjectTransferWorker,
    store: Arc<dyn AttachmentTransferRepository>,
}

impl AttachmentTransferWorker {
    pub fn new(
        store: Arc<dyn AttachmentTransferRepository>,
        transport: Arc<dyn AttachmentTransferTransport>,
        blobs: Arc<dyn ObjectBlob>,
    ) -> Self {
        let repository = store.clone();
        Self {
            inner: ObjectTransferWorker::new(
                Arc::new(RepositoryAdapter { inner: repository }),
                Arc::new(TransportAdapter { inner: transport }),
                blobs,
                Arc::new(ChatCommitmentCodec),
            ),
            store,
        }
    }

    pub fn with_control(
        store: Arc<dyn AttachmentTransferRepository>,
        transport: Arc<dyn AttachmentTransferTransport>,
        blobs: Arc<dyn ObjectBlob>,
        control: Arc<AttachmentTransferControl>,
        retry_policy: AttachmentRetryPolicy,
    ) -> Result<Self, String> {
        let repository = store.clone();
        Ok(Self {
            inner: ObjectTransferWorker::with_control(
                Arc::new(RepositoryAdapter { inner: repository }),
                Arc::new(TransportAdapter { inner: transport }),
                blobs,
                Arc::new(ChatCommitmentCodec),
                control.inner.clone(),
                retry_policy.into(),
            )?,
            store,
        })
    }

    pub fn memory_bound(chunk_size: u32) -> usize {
        ObjectTransferWorker::memory_bound(chunk_size)
    }

    pub fn run_upload_once(
        &self,
        attachment_id: &str,
        now_unix_ms: i64,
    ) -> Result<AttachmentTransferProgress, String> {
        if let Some(progress) =
            self.terminalize_invalid_persisted_record(attachment_id, now_unix_ms)?
        {
            return Ok(progress);
        }
        self.inner
            .run_upload_once(attachment_id, now_unix_ms)
            .map(Into::into)
            .map_err(|failure| core_failure_to_chat(failure).to_string())
    }

    pub fn run_download_once(
        &self,
        attachment_id: &str,
        descriptor: &EncryptedObjectDescriptor,
        expected_plaintext_sha256: &[u8; 32],
        cache_ref: &str,
        now_unix_ms: i64,
    ) -> Result<AttachmentTransferProgress, String> {
        if let Some(progress) =
            self.terminalize_invalid_persisted_record(attachment_id, now_unix_ms)?
        {
            return Ok(progress);
        }
        let descriptor = match chat_descriptor_to_core(descriptor) {
            Ok(descriptor) => descriptor,
            Err(_) => return self.persist_terminal_descriptor_failure(attachment_id, now_unix_ms),
        };
        self.inner
            .run_download_once(
                attachment_id,
                &descriptor,
                expected_plaintext_sha256,
                cache_ref,
                now_unix_ms,
            )
            .map(Into::into)
            .map_err(|failure| core_failure_to_chat(failure).to_string())
    }

    pub fn cancel(&self, attachment_id: &str, now_unix_ms: i64) -> Result<(), String> {
        self.inner
            .cancel(attachment_id, now_unix_ms)
            .map_err(|failure| core_failure_to_chat(failure).to_string())
    }

    fn persist_terminal_descriptor_failure(
        &self,
        attachment_id: &str,
        now_unix_ms: i64,
    ) -> Result<AttachmentTransferProgress, String> {
        let transfer = self
            .store
            .attachment_transfer(attachment_id)?
            .ok_or_else(|| "messaging attachment transfer is unavailable".to_string())?;
        if transfer.state == crate::proto::chat::AttachmentTransferState::Complete as i32 {
            return Ok(AttachmentTransferProgress::Complete);
        }
        let attempt_count = transfer.attempt_count.saturating_add(1);
        self.store.terminalize_attachment_transfer(
            attachment_id,
            attempt_count,
            AttachmentTransferErrorCode::IntegrityFailed as i32,
            now_unix_ms,
        )?;
        Ok(AttachmentTransferProgress::Terminal {
            code: AttachmentTransferErrorCode::IntegrityFailed,
        })
    }

    fn terminalize_invalid_persisted_record(
        &self,
        attachment_id: &str,
        now_unix_ms: i64,
    ) -> Result<Option<AttachmentTransferProgress>, String> {
        let Some(transfer) = self.store.attachment_transfer(attachment_id)? else {
            return Ok(None);
        };
        if transfer.state == crate::proto::chat::AttachmentTransferState::Terminal as i32
            && transfer.last_error_code == AttachmentTransferErrorCode::IntegrityFailed as i32
        {
            return Ok(Some(AttachmentTransferProgress::Terminal {
                code: AttachmentTransferErrorCode::IntegrityFailed,
            }));
        }
        if validate_chat_attachment_transfer_record(&transfer).is_ok() {
            return Ok(None);
        }
        let attempt_count = transfer.attempt_count.saturating_add(1);
        self.store.terminalize_attachment_transfer(
            attachment_id,
            attempt_count,
            AttachmentTransferErrorCode::IntegrityFailed as i32,
            now_unix_ms,
        )?;
        Ok(Some(AttachmentTransferProgress::Terminal {
            code: AttachmentTransferErrorCode::IntegrityFailed,
        }))
    }
}

pub fn upload_commitment_fields(
    conversation_id: &str,
    message_id: &str,
    attachment_id: &str,
    authority_station_id: &str,
    object: &EncryptedObjectUploadSpec,
) -> [u8; 32] {
    let object_bytes = object.encode_to_vec();
    let mut hash = Sha256::new();
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

fn repository_failure(detail: String) -> ObjectTransferFailure {
    if detail.contains("attachment descriptor commitment changed") {
        return ObjectTransferFailure::terminal(
            ObjectTransferErrorCode::DescriptorMismatch,
            detail,
        );
    }
    ObjectTransferFailure::retryable(ObjectTransferErrorCode::RetryLater, None, detail)
}

fn integrity_failure(detail: impl Into<String>) -> ObjectTransferFailure {
    ObjectTransferFailure::terminal(ObjectTransferErrorCode::IntegrityFailed, detail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::chat::{
        AttachmentEncryptionSuite, AttachmentNonceStrategy, AttachmentTransferDirection,
        AttachmentTransferState,
    };
    use secure_content_core::object::{EncryptedObjectChunk, OBJECT_CHUNK_SIZE, OBJECT_TAG_SIZE};
    use secure_content_core::ports::ObjectBlob;
    use std::sync::Mutex;

    #[test]
    fn chat_commitment_vector_is_unchanged() {
        let spec = EncryptedObjectUploadSpec {
            ciphertext_size: 33,
            ciphertext_sha256: vec![1; 32],
            media_type: "application/octet-stream".to_string(),
            chunk_size: OBJECT_CHUNK_SIZE,
            chunk_count: 1,
            encryption_suite: AttachmentEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: OBJECT_TAG_SIZE,
            nonce_strategy: AttachmentNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: vec![vec![2; 32]],
        };
        assert_eq!(
            upload_commitment_fields("conversation", "message", "attachment", "station", &spec),
            [
                28, 202, 76, 121, 134, 80, 57, 149, 134, 84, 214, 94, 0, 174, 253, 216, 47, 58,
                161, 119, 113, 96, 175, 167, 173, 149, 84, 58, 33, 198, 84, 44,
            ]
        );
    }

    #[test]
    fn chat_transfer_round_trip_preserves_persisted_numeric_values() {
        let record = AttachmentTransferRecord {
            attachment_id: "attachment".to_string(),
            conversation_id: "conversation".to_string(),
            message_id: "message".to_string(),
            authority_station_id: "station".to_string(),
            direction: AttachmentTransferDirection::Download as i32,
            state: AttachmentTransferState::RetryWait as i32,
            upload_id: "upload".to_string(),
            generation: 2,
            descriptor_sha256: vec![1; 32],
            completed_chunk_bitmap: vec![0],
            source_local_ref: String::new(),
            partial_local_ref: "partial".to_string(),
            object_key: vec![2; 32],
            base_nonce: vec![0; 12],
            plaintext_size: 17,
            chunk_size: OBJECT_CHUNK_SIZE,
            attempt_count: 1,
            next_attempt_at_unix_ms: 3,
            last_error_code: AttachmentTransferErrorCode::RetryLater as i32,
            updated_at_unix_ms: 4,
        };
        let core = chat_transfer_record_to_core(&record).unwrap();
        assert_eq!(core_transfer_record_to_chat(&core), record);
    }

    struct TerminalStore {
        record: Mutex<AttachmentTransferRecord>,
    }

    impl AttachmentTransferRepository for TerminalStore {
        fn attachment_transfer(
            &self,
            attachment_id: &str,
        ) -> Result<Option<AttachmentTransferRecord>, String> {
            let record = self.record.lock().unwrap();
            Ok((record.attachment_id == attachment_id).then(|| record.clone()))
        }

        fn attachment_upload_media_type(&self, _attachment_id: &str) -> Result<String, String> {
            panic!("conversion failure must not reach upload preparation")
        }

        fn update_attachment_transfer_prepared(
            &self,
            _attachment_id: &str,
            _descriptor_sha256: &[u8],
            _partial_local_ref: &str,
            _updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            panic!("conversion failure must not prepare a transfer")
        }

        fn update_attachment_transfer_progress(
            &self,
            _attachment_id: &str,
            state: i32,
            _upload_id: &str,
            _generation: u64,
            _completed_chunk_bitmap: &[u8],
            attempt_count: u32,
            _next_attempt_at_unix_ms: i64,
            last_error_code: i32,
            updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            let mut record = self.record.lock().unwrap();
            record.state = state;
            record.attempt_count = attempt_count;
            record.last_error_code = last_error_code;
            record.updated_at_unix_ms = updated_at_unix_ms;
            Ok(())
        }

        fn terminalize_attachment_transfer(
            &self,
            _attachment_id: &str,
            attempt_count: u32,
            last_error_code: i32,
            updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            let mut record = self.record.lock().unwrap();
            record.state = AttachmentTransferState::Terminal as i32;
            record.attempt_count = attempt_count;
            record.next_attempt_at_unix_ms = 0;
            record.last_error_code = last_error_code;
            record.updated_at_unix_ms = updated_at_unix_ms;
            Ok(())
        }

        fn complete_attachment_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
            _descriptor: &EncryptedObjectDescriptor,
            _updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            panic!("conversion failure must not complete an upload")
        }

        fn complete_attachment_download(
            &self,
            _transfer: &AttachmentTransferRecord,
            _descriptor: &EncryptedObjectDescriptor,
            _cache_path: &str,
            _updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            panic!("conversion failure must not complete a download")
        }
    }

    struct UnusedTransport;

    impl AttachmentTransferTransport for UnusedTransport {
        fn begin_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
            _prepared: &PreparedAttachmentUpload,
        ) -> Result<(String, u64, Vec<u8>), AttachmentTransferFailure> {
            panic!("conversion failure must not call transport")
        }

        fn put_upload_chunk(
            &self,
            _transfer: &AttachmentTransferRecord,
            _chunk: &EncryptedObjectChunk,
        ) -> Result<(), AttachmentTransferFailure> {
            panic!("conversion failure must not call transport")
        }

        fn complete_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
            _prepared: &PreparedAttachmentUpload,
        ) -> Result<EncryptedObjectDescriptor, AttachmentTransferFailure> {
            panic!("conversion failure must not call transport")
        }

        fn get_download_chunk(
            &self,
            _transfer: &AttachmentTransferRecord,
            _descriptor: &EncryptedObjectDescriptor,
            _chunk_index: u32,
            _start: u64,
            _end: u64,
        ) -> Result<Vec<u8>, AttachmentTransferFailure> {
            panic!("conversion failure must not call transport")
        }

        fn cancel_upload(
            &self,
            _transfer: &AttachmentTransferRecord,
        ) -> Result<(), AttachmentTransferFailure> {
            panic!("conversion failure must not call transport")
        }
    }

    struct UnusedBlob;

    impl ObjectBlob for UnusedBlob {
        fn exists(&self, _blob_ref: &str) -> Result<bool, String> {
            panic!("conversion failure must not access blobs")
        }

        fn len(&self, _blob_ref: &str) -> Result<u64, String> {
            panic!("conversion failure must not access blobs")
        }

        fn read_chunk(
            &self,
            _blob_ref: &str,
            _offset: u64,
            _length: usize,
        ) -> Result<Vec<u8>, String> {
            panic!("conversion failure must not access blobs")
        }

        fn write_chunk(&self, _blob_ref: &str, _offset: u64, _data: &[u8]) -> Result<(), String> {
            panic!("conversion failure must not access blobs")
        }

        fn truncate(&self, _blob_ref: &str, _length: u64) -> Result<(), String> {
            panic!("conversion failure must not access blobs")
        }

        fn sha256(&self, _blob_ref: &str) -> Result<[u8; 32], String> {
            panic!("conversion failure must not access blobs")
        }

        fn promote(&self, _source_ref: &str, _target_ref: &str) -> Result<(), String> {
            panic!("conversion failure must not access blobs")
        }

        fn remove(&self, _blob_ref: &str) -> Result<(), String> {
            panic!("conversion failure must not access blobs")
        }
    }

    #[test]
    fn invalid_chat_descriptor_persists_terminal_integrity_failure() {
        let store = Arc::new(TerminalStore {
            record: Mutex::new(AttachmentTransferRecord {
                attachment_id: "attachment".to_string(),
                conversation_id: "conversation".to_string(),
                message_id: "message".to_string(),
                authority_station_id: "station".to_string(),
                direction: AttachmentTransferDirection::Download as i32,
                state: AttachmentTransferState::Queued as i32,
                upload_id: "upload".to_string(),
                generation: 1,
                descriptor_sha256: vec![0; 32],
                completed_chunk_bitmap: vec![0],
                source_local_ref: String::new(),
                partial_local_ref: "partial".to_string(),
                object_key: vec![1; 32],
                base_nonce: vec![0; 12],
                plaintext_size: 17,
                chunk_size: OBJECT_CHUNK_SIZE,
                attempt_count: 0,
                next_attempt_at_unix_ms: 0,
                last_error_code: 0,
                updated_at_unix_ms: 1,
            }),
        });
        let worker = AttachmentTransferWorker::new(
            store.clone(),
            Arc::new(UnusedTransport),
            Arc::new(UnusedBlob),
        );
        let descriptor = EncryptedObjectDescriptor {
            encryption_suite: i32::MAX,
            ..Default::default()
        };

        assert_eq!(
            worker
                .run_download_once("attachment", &descriptor, &[0; 32], "cache", 9)
                .unwrap(),
            AttachmentTransferProgress::Terminal {
                code: AttachmentTransferErrorCode::IntegrityFailed,
            }
        );
        let persisted = store.record.lock().unwrap();
        assert_eq!(persisted.state, AttachmentTransferState::Terminal as i32);
        assert_eq!(
            persisted.last_error_code,
            AttachmentTransferErrorCode::IntegrityFailed as i32
        );
        assert_eq!(persisted.attempt_count, 1);
        assert_eq!(persisted.updated_at_unix_ms, 9);
    }

    #[test]
    fn malformed_persisted_transfer_is_terminalized_before_core_dispatch() {
        let store = Arc::new(TerminalStore {
            record: Mutex::new(AttachmentTransferRecord {
                attachment_id: "attachment".to_string(),
                conversation_id: "conversation".to_string(),
                message_id: "message".to_string(),
                authority_station_id: "station".to_string(),
                direction: AttachmentTransferDirection::Download as i32,
                state: AttachmentTransferState::Queued as i32,
                upload_id: "upload".to_string(),
                generation: 1,
                descriptor_sha256: vec![0; 32],
                completed_chunk_bitmap: Vec::new(),
                source_local_ref: "source".to_string(),
                partial_local_ref: String::new(),
                object_key: vec![1; 32],
                base_nonce: vec![0; 12],
                plaintext_size: 17,
                chunk_size: OBJECT_CHUNK_SIZE,
                attempt_count: 0,
                next_attempt_at_unix_ms: 0,
                last_error_code: 0,
                updated_at_unix_ms: 1,
            }),
        });
        let worker = AttachmentTransferWorker::new(
            store.clone(),
            Arc::new(UnusedTransport),
            Arc::new(UnusedBlob),
        );

        assert_eq!(
            worker.run_upload_once("attachment", 11).unwrap(),
            AttachmentTransferProgress::Terminal {
                code: AttachmentTransferErrorCode::IntegrityFailed,
            }
        );
        let persisted = store.record.lock().unwrap();
        assert_eq!(persisted.state, AttachmentTransferState::Terminal as i32);
        assert_eq!(
            persisted.last_error_code,
            AttachmentTransferErrorCode::IntegrityFailed as i32
        );
        assert_eq!(persisted.attempt_count, 1);
        assert_eq!(persisted.updated_at_unix_ms, 11);
    }
}
