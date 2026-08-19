use super::double_ratchet::DrSessionState;
use crate::contracts::CryptoEndpoint;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct DirectSessionKey {
    pub conversation_id: String,
    pub local: CryptoEndpoint,
    pub peer: CryptoEndpoint,
    pub generation: u64,
}

impl DirectSessionKey {
    pub fn new(
        conversation_id: impl Into<String>,
        local: CryptoEndpoint,
        peer: CryptoEndpoint,
        generation: u64,
    ) -> Result<Self, String> {
        let key = Self {
            conversation_id: conversation_id.into(),
            local,
            peer,
            generation,
        };
        key.validate()?;
        Ok(key)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.conversation_id.trim().is_empty() {
            return Err("direct session requires a conversation ID".to_string());
        }
        if self.local.ptid.trim().is_empty() || self.local.device_id.trim().is_empty() {
            return Err("direct session local endpoint is incomplete".to_string());
        }
        if self.peer.ptid.trim().is_empty() || self.peer.device_id.trim().is_empty() {
            return Err("direct session peer endpoint is incomplete".to_string());
        }
        if self.local == self.peer {
            return Err("direct-session endpoints must differ".to_string());
        }
        if self.generation == 0 {
            return Err("direct-session generation must be positive".to_string());
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct DirectSession {
    pub session_id: String,
    pub key: DirectSessionKey,
    pub protocol_version: u32,
    pub established: bool,
    pub peer_identity_key: [u8; 32],
    pub ratchet: DrSessionState,
    pub updated_at_unix_ms: i64,
}
