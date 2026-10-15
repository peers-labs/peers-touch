use crate::domain::storage::key_management::KeyProvider;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use libp2p_identity::Keypair;
use sha2::{Digest, Sha256};
use std::fmt;

const TRANSPORT_KEY_PREFIX: &str = "peers-touch.desktop.station-transport.v1";

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum TransportIdentityScope {
    DirectStation(String),
    Relay(String),
    ProvisionalEndpointOrigin(String),
}

impl TransportIdentityScope {
    fn canonical_value(&self) -> (&'static str, &str) {
        match self {
            Self::DirectStation(value) => ("direct-station", value),
            Self::Relay(value) => ("relay", value),
            Self::ProvisionalEndpointOrigin(value) => ("provisional-origin", value),
        }
    }

    pub fn stable_id(&self) -> String {
        let (kind, value) = self.canonical_value();
        let mut digest = Sha256::new();
        digest.update(b"peers-touch/station-transport-identity-scope/v1\0");
        digest.update(kind.as_bytes());
        digest.update([0]);
        digest.update(value.trim().as_bytes());
        format!("{kind}:{}", hex::encode(digest.finalize()))
    }

    fn key_ref(&self) -> String {
        format!("{TRANSPORT_KEY_PREFIX}/{}", self.stable_id())
    }
}

#[derive(Debug)]
pub struct TransportIdentityError(String);

impl fmt::Display for TransportIdentityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for TransportIdentityError {}

#[derive(Default)]
pub struct TransportIdentityStore {
    provider: PlatformKeyProvider,
}

impl TransportIdentityStore {
    pub fn new() -> Self {
        Self {
            provider: PlatformKeyProvider::new(),
        }
    }

    pub fn keypair(
        &self,
        scope: &TransportIdentityScope,
    ) -> Result<Keypair, TransportIdentityError> {
        let material = self
            .provider
            .get_or_create_key(&scope.key_ref())
            .map_err(|error| {
                TransportIdentityError(format!("load scoped Station transport identity: {error}"))
            })?;
        if material.key_bytes.len() != 32 {
            return Err(TransportIdentityError(
                "scoped Station transport identity has invalid key length".to_string(),
            ));
        }
        Keypair::ed25519_from_bytes(material.key_bytes.clone()).map_err(|error| {
            TransportIdentityError(format!("decode scoped Station transport identity: {error}"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_scopes_are_unlinkable_by_key_reference() {
        let first = TransportIdentityScope::Relay("relay-a".to_string());
        let second = TransportIdentityScope::Relay("relay-b".to_string());
        assert_ne!(first.stable_id(), second.stable_id());
        assert_eq!(first.stable_id(), first.clone().stable_id());
    }
}
