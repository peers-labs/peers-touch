use crate::contracts::AttachmentId;

pub trait AttachmentTransferPort: Send + Sync {
    fn upload_chunk(
        &self,
        attachment_id: &AttachmentId,
        chunk_index: u32,
        data: &[u8],
    ) -> Result<(), AttachmentTransferError>;

    fn download_range(
        &self,
        attachment_id: &AttachmentId,
        offset: u64,
        length: u64,
    ) -> Result<Vec<u8>, AttachmentTransferError>;

    fn finalize_upload(&self, attachment_id: &AttachmentId) -> Result<(), AttachmentTransferError>;
}

#[derive(Debug, thiserror::Error)]
pub enum AttachmentTransferError {
    #[error("network: {0}")]
    Network(String),
    #[error("conflict: attachment already active")]
    Conflict,
    #[error("not found")]
    NotFound,
    #[error("server: {0}")]
    Server(String),
}
