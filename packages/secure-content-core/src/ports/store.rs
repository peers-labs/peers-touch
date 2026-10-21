use crate::object::{
    ObjectDescriptor, ObjectTransferFailure, ObjectTransferRecord, ObjectTransferState,
    ObjectUploadSpec,
};
use crate::operation::{OperationFailure, OperationFence, OperationRecord};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredOperation {
    pub record: OperationRecord,
    pub command_bytes: Vec<u8>,
}

impl StoredOperation {
    pub fn validate(&self) -> Result<(), OperationFailure> {
        self.record.validate_command_bytes(&self.command_bytes)
    }
}

pub trait EncryptedOperationStore: Send + Sync {
    fn operation(&self, operation_id: &str) -> Result<Option<StoredOperation>, OperationFailure>;

    fn insert_operation(&self, operation: &StoredOperation) -> Result<(), OperationFailure>;

    fn compare_and_swap_operation(
        &self,
        expected: OperationFence<'_>,
        operation: &OperationRecord,
    ) -> Result<bool, OperationFailure>;
}

pub trait ObjectCommitmentCodec: Send + Sync {
    fn upload_commitment(
        &self,
        transfer: &ObjectTransferRecord,
        object: &ObjectUploadSpec,
    ) -> Result<[u8; 32], ObjectTransferFailure>;

    fn descriptor_commitment(
        &self,
        descriptor: &ObjectDescriptor,
    ) -> Result<[u8; 32], ObjectTransferFailure>;
}

pub trait ObjectTransferRepository: Send + Sync {
    fn object_transfer(
        &self,
        transfer_id: &str,
    ) -> Result<Option<ObjectTransferRecord>, ObjectTransferFailure>;

    fn upload_media_type(&self, transfer_id: &str)
        -> Result<Option<String>, ObjectTransferFailure>;

    fn update_transfer_prepared(
        &self,
        transfer_id: &str,
        descriptor_sha256: &[u8],
        partial_local_ref: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure>;

    #[allow(clippy::too_many_arguments)]
    fn update_transfer_progress(
        &self,
        transfer_id: &str,
        state: ObjectTransferState,
        upload_id: &str,
        generation: u64,
        completed_chunk_bitmap: &[u8],
        attempt_count: u32,
        next_attempt_at_unix_ms: i64,
        last_error: Option<crate::object::ObjectTransferErrorCode>,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure>;

    fn complete_upload(
        &self,
        transfer: &ObjectTransferRecord,
        descriptor: &ObjectDescriptor,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure>;

    fn complete_download(
        &self,
        transfer: &ObjectTransferRecord,
        descriptor: &ObjectDescriptor,
        cache_path: &str,
        updated_at_unix_ms: i64,
    ) -> Result<(), ObjectTransferFailure>;
}
