pub trait ObjectBlob: Send + Sync {
    fn exists(&self, blob_ref: &str) -> Result<bool, String>;
    fn len(&self, blob_ref: &str) -> Result<u64, String>;
    fn read_chunk(&self, blob_ref: &str, offset: u64, length: usize) -> Result<Vec<u8>, String>;
    fn write_chunk(&self, blob_ref: &str, offset: u64, data: &[u8]) -> Result<(), String>;
    fn truncate(&self, blob_ref: &str, length: u64) -> Result<(), String>;
    fn sha256(&self, blob_ref: &str) -> Result<[u8; 32], String>;
    fn promote(&self, source_ref: &str, target_ref: &str) -> Result<(), String>;
    fn remove(&self, blob_ref: &str) -> Result<(), String>;
}
