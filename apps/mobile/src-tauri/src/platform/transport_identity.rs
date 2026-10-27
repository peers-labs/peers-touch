use base64::{engine::general_purpose::STANDARD, Engine as _};
use libp2p_identity::Keypair;
use rand::RngCore;
use station_trust::transport_identity::TransportIdentityScope;
use zeroize::Zeroizing;

use super::secure_storage::SecureStorage;
use crate::error::{MobileError, MobileResult};

const PREFIX: &str = "peers-touch.mobile.station-transport.v1";

pub(crate) fn storage_key(scope: &TransportIdentityScope) -> String {
    format!("{PREFIX}.{}", scope.stable_id().replace(':', "."))
}

/// The caller serializes creation with transport admission. A corrupt or
/// unavailable secure-store entry fails closed; it never silently rotates.
pub(crate) fn keypair(
    storage: &SecureStorage,
    scope: &TransportIdentityScope,
) -> MobileResult<Keypair> {
    let key = storage_key(scope);
    let stored = match storage.get(&key)? {
        Some(stored) => Zeroizing::new(stored),
        None => {
            let mut seed = Zeroizing::new([0u8; 32]);
            rand::rngs::OsRng.fill_bytes(seed.as_mut());
            let encoded = Zeroizing::new(STANDARD.encode(seed.as_slice()));
            storage.set(&key, &encoded)?;
            let recovered = Zeroizing::new(storage.get(&key)?.ok_or_else(|| {
                MobileError::secure_storage("station transport identity persistence failed")
            })?);
            if *recovered != *encoded {
                return Err(MobileError::secure_storage(
                    "station transport identity readback mismatch",
                ));
            }
            recovered
        }
    };
    let mut decoded = Zeroizing::new(
        STANDARD
            .decode(stored.as_bytes())
            .map_err(|_| MobileError::secure_storage("invalid station transport identity"))?,
    );
    if decoded.len() != 32 {
        return Err(MobileError::secure_storage(
            "invalid station transport identity length",
        ));
    }
    Keypair::ed25519_from_bytes(decoded.as_mut_slice())
        .map_err(|_| MobileError::secure_storage("invalid station transport key"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_keys_fit_the_android_store_without_collapsing_roles_or_endpoints() {
        let scopes = [
            TransportIdentityScope::DirectStation("peer-a".into()),
            TransportIdentityScope::Relay("peer-a".into()),
            TransportIdentityScope::Relay("peer-b".into()),
            TransportIdentityScope::ProvisionalEndpointOrigin("https://peer-a.example".into()),
        ];
        let keys = scopes.iter().map(storage_key).collect::<Vec<_>>();
        for (index, key) in keys.iter().enumerate() {
            assert!(key.len() <= 256);
            assert!(key
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.')));
            assert_eq!(key, &storage_key(&scopes[index]));
            assert!(!keys[..index].contains(key));
        }
    }
}
