use crate::object::{
    EncryptedObjectChunk, ObjectDescriptor, ObjectTransferFailure, ObjectTransferRecord,
    PreparedObjectUpload,
};
use crate::operation::{
    ContentPreKeyInventory, ContentPreKeyPoolKind, ContentPreKeyPublishDisposition,
    OperationFailure,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContentPreKeyInventoryRead {
    Found(ContentPreKeyInventory),
    PoolNotFound,
}

pub trait ContentPreKeyTransport: Send + Sync {
    fn inventory(
        &self,
        kind: ContentPreKeyPoolKind,
    ) -> Result<ContentPreKeyInventoryRead, OperationFailure>;

    fn publish(
        &self,
        canonical_request: &[u8],
    ) -> Result<ContentPreKeyPublishDisposition, OperationFailure>;
}

pub trait ObjectTransferTransport: Send + Sync {
    fn begin_upload(
        &self,
        transfer: &ObjectTransferRecord,
        prepared: &PreparedObjectUpload,
    ) -> Result<(String, u64, Vec<u8>), ObjectTransferFailure>;

    fn put_upload_chunk(
        &self,
        transfer: &ObjectTransferRecord,
        chunk: &EncryptedObjectChunk,
    ) -> Result<(), ObjectTransferFailure>;

    fn complete_upload(
        &self,
        transfer: &ObjectTransferRecord,
        prepared: &PreparedObjectUpload,
    ) -> Result<ObjectDescriptor, ObjectTransferFailure>;

    fn get_download_chunk(
        &self,
        transfer: &ObjectTransferRecord,
        descriptor: &ObjectDescriptor,
        chunk_index: u32,
        start: u64,
        end: u64,
    ) -> Result<Vec<u8>, ObjectTransferFailure>;

    fn cancel_upload(&self, transfer: &ObjectTransferRecord) -> Result<(), ObjectTransferFailure>;
}
