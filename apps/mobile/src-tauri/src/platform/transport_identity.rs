use base64::{engine::general_purpose::STANDARD, Engine as _};
use libp2p_identity::Keypair;
use rand::RngCore;
use station_trust::transport_identity::TransportIdentityScope;
use zeroize::Zeroizing;

use super::secure_storage::SecureStorage;
use crate::error::{MobileError, MobileResult};

const PREFIX: &str = "peers-touch.mobile.station-transport.v1";

/// The caller serializes creation with transport admission. A corrupt or
/// unavailable secure-store entry fails closed; it never silently rotates.
pub(crate) fn keypair(
    storage: &SecureStorage,
    scope: &TransportIdentityScope,
) -> MobileResult<Keypair> {
    let key = format!("{PREFIX}/{}", scope.stable_id());
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
