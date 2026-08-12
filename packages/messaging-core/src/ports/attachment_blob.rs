use crate::contracts::{AttachmentId, CachePath};

pub trait AttachmentBlob: Send + Sync {
    fn stage(&self, attachment_id: &AttachmentId, data: &[u8]) -> Result<CachePath, String>;
    fn read(&self, attachment_id: &AttachmentId) -> Result<Vec<u8>, String>;
    fn cache_path(&self, attachment_id: &AttachmentId) -> Result<CachePath, String>;
    fn remove(&self, attachment_id: &AttachmentId) -> Result<(), String>;
}
