use crate::object::{
    ObjectDescriptor, ObjectTransferFailure, ObjectTransferRecord, ObjectTransferState,
    ObjectUploadSpec,
};

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
