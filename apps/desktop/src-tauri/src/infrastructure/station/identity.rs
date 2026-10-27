use crate::domain::storage::key_management::KeyProvider;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use libp2p_identity::Keypair;
use station_trust::transport_identity::TransportIdentityScope;
use std::fmt;

const TRANSPORT_KEY_PREFIX: &str = "peers-touch.desktop.station-transport.v1";

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
            .get_or_create_key(&format!("{TRANSPORT_KEY_PREFIX}/{}", scope.stable_id()))
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
