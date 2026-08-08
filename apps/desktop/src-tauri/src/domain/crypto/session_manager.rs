//! Direct-session identity and in-memory ratchet coordination.

use std::collections::HashMap;

use super::double_ratchet::{self, DrCiphertextWire, DrSessionState, DrSkippedMessageKey};
use super::error::CryptoError;
use super::identity::{IdentityKeyPair, X25519KeyPair};
use super::x3dh::{self, PreKeyBundle, X3dhReceiverInput};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CryptoEndpoint {
    pub ptid: String,
    pub device_id: String,
}

impl CryptoEndpoint {
    pub fn new(ptid: impl Into<String>, device_id: impl Into<String>) -> Result<Self, CryptoError> {
        let endpoint = Self {
            ptid: ptid.into(),
            device_id: device_id.into(),
        };
        endpoint.validate()?;
        Ok(endpoint)
    }

    pub fn validate(&self) -> Result<(), CryptoError> {
        if self.ptid.trim().is_empty() || self.device_id.trim().is_empty() {
            return Err(CryptoError::SessionStateInvalid(
                "crypto endpoint requires PTID and device ID".into(),
            ));
        }
        Ok(())
    }
}

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
    ) -> Result<Self, CryptoError> {
        let key = Self {
            conversation_id: conversation_id.into(),
            local,
            peer,
            generation,
        };
        key.validate()?;
        Ok(key)
    }

    pub fn validate(&self) -> Result<(), CryptoError> {
        if self.conversation_id.trim().is_empty() {
            return Err(CryptoError::SessionStateInvalid(
                "direct session requires a conversation ID".into(),
            ));
        }
        self.local.validate()?;
        self.peer.validate()?;
        if self.local == self.peer {
            return Err(CryptoError::SessionStateInvalid(
                "direct-session endpoints must differ".into(),
            ));
        }
        if self.generation == 0 {
            return Err(CryptoError::SessionStateInvalid(
                "direct-session generation must be positive".into(),
            ));
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

pub struct PreparedDeviceCiphertext {
    pub session_id: String,
    pub recipient: CryptoEndpoint,
    pub wire: DrCiphertextWire,
}

pub struct PreparedFanOut {
    pub sessions: Vec<DirectSession>,
    pub ciphertexts: Vec<PreparedDeviceCiphertext>,
}

#[derive(Default)]
pub struct SessionManager {
    sessions: HashMap<DirectSessionKey, DirectSession>,
    skipped_keys: HashMap<DirectSessionKey, Vec<DrSkippedMessageKey>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load_session(&mut self, session: DirectSession) -> Result<(), CryptoError> {
        session.key.validate()?;
        if session.session_id.trim().is_empty() {
            return Err(CryptoError::SessionStateInvalid(
                "direct session requires a session ID".into(),
            ));
        }
        self.sessions.insert(session.key.clone(), session);
        Ok(())
    }

    pub fn load_skipped_keys(
        &mut self,
        key: DirectSessionKey,
        keys: Vec<DrSkippedMessageKey>,
    ) -> Result<(), CryptoError> {
        key.validate()?;
        self.skipped_keys.insert(key, keys);
        Ok(())
    }

    pub fn get(&self, key: &DirectSessionKey) -> Option<&DirectSession> {
        self.sessions.get(key)
    }

    pub fn establish_sender_session(
        session_id: String,
        key: DirectSessionKey,
        protocol_version: u32,
        our_identity: &IdentityKeyPair,
        peer_bundle: &PreKeyBundle,
        now_unix_ms: i64,
    ) -> Result<(DirectSession, super::x3dh::X3dhSenderResult), CryptoError> {
        key.validate()?;
        let x3dh = x3dh::x3dh_sender(our_identity, peer_bundle)?;
        let ratchet =
            double_ratchet::init_initiator(&session_id, &x3dh.shared_secret, peer_bundle.spk_pub);
        Ok((
            DirectSession {
                session_id,
                key,
                protocol_version,
                established: false,
                peer_identity_key: peer_bundle.ik_pub,
                ratchet,
                updated_at_unix_ms: now_unix_ms,
            },
            x3dh,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn establish_receiver_session(
        session_id: String,
        key: DirectSessionKey,
        protocol_version: u32,
        our_identity: &IdentityKeyPair,
        our_spk: &X25519KeyPair,
        our_opk: Option<&X25519KeyPair>,
        input: &X3dhReceiverInput,
        now_unix_ms: i64,
    ) -> Result<DirectSession, CryptoError> {
        key.validate()?;
        let shared_secret = x3dh::x3dh_receiver(our_identity, our_spk, our_opk, input)?;
        let ratchet =
            double_ratchet::init_responder(&session_id, &shared_secret, our_spk.private_bytes());
        Ok(DirectSession {
            session_id,
            key,
            protocol_version,
            established: true,
            peer_identity_key: input.sender_ik_pub,
            ratchet,
            updated_at_unix_ms: now_unix_ms,
        })
    }

    pub fn prepare_fan_out(
        sessions: &[DirectSession],
        plaintext: &[u8],
        aad_extra: &[u8],
        now_unix_ms: i64,
    ) -> Result<PreparedFanOut, CryptoError> {
        if sessions.is_empty() {
            return Err(CryptoError::DeviceListUnavailable(
                "no direct sessions supplied".into(),
            ));
        }

        let mut advanced = Vec::with_capacity(sessions.len());
        let mut ciphertexts = Vec::with_capacity(sessions.len());
        for session in sessions {
            session.key.validate()?;
            if !session.established {
                return Err(CryptoError::SessionStateInvalid(format!(
                    "session {} is not ready",
                    session.session_id
                )));
            }
            let mut next = session.clone();
            let wire = double_ratchet::encrypt(&mut next.ratchet, plaintext, aad_extra)?;
            next.updated_at_unix_ms = now_unix_ms;
            ciphertexts.push(PreparedDeviceCiphertext {
                session_id: next.session_id.clone(),
                recipient: next.key.peer.clone(),
                wire,
            });
            advanced.push(next);
        }

        Ok(PreparedFanOut {
            sessions: advanced,
            ciphertexts,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint(ptid: &str, device_id: &str) -> CryptoEndpoint {
        CryptoEndpoint::new(ptid, device_id).unwrap()
    }

    fn key(peer_device: &str, generation: u64) -> DirectSessionKey {
        DirectSessionKey::new(
            "conversation-1",
            endpoint("ptid:alice", "alice-device"),
            endpoint("ptid:bob", peer_device),
            generation,
        )
        .unwrap()
    }

    #[test]
    fn endpoint_pair_and_generation_are_part_of_identity() {
        assert_ne!(key("bob-phone", 1), key("bob-desktop", 1));
        assert_ne!(key("bob-phone", 1), key("bob-phone", 2));
    }

    #[test]
    fn invalid_or_reflexive_endpoints_fail_closed() {
        assert!(CryptoEndpoint::new("", "device").is_err());
        assert!(DirectSessionKey::new(
            "conversation-1",
            endpoint("ptid:alice", "same"),
            endpoint("ptid:alice", "same"),
            1,
        )
        .is_err());
        assert!(DirectSessionKey::new(
            "conversation-1",
            endpoint("ptid:alice", "a"),
            endpoint("ptid:bob", "b"),
            0,
        )
        .is_err());
    }
}
