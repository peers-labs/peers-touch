use crate::contracts::DeviceId;

pub trait QueueTransport: Send + Sync {
    fn drain(&self, device_id: &DeviceId, batch_limit: u32) -> Result<DrainResult, TransportError>;

    fn ack(&self, device_id: &DeviceId, inbox_item_id: &str) -> Result<(), TransportError>;

    fn send_envelope(&self, envelope: &[u8]) -> Result<(), TransportError>;
}

pub struct DrainResult {
    pub items: Vec<InboxItem>,
    pub has_more: bool,
}

pub struct InboxItem {
    pub id: String,
    pub envelope_bytes: Vec<u8>,
    pub received_at_unix_ms: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("network: {0}")]
    Network(String),
    #[error("auth expired")]
    AuthExpired,
    #[error("server: {0}")]
    Server(String),
}
