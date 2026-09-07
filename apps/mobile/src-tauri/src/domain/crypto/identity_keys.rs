use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};

use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;

const KEY_PREFIX: &str = "mobile-crypto-identity";
const STORE_VERSION: u32 = 1;

pub struct IdentityKeyPair {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
}

pub fn ensure_identity(
    storage: &SecureStorage,
    user_scope: &str,
    actor_ptid: &str,
) -> MobileResult<IdentityKeyPair> {
    let key = identity_key(user_scope, actor_ptid);
    if let Some(stored) = storage.get(&key)? {
        return identity_from_seed_b64(&stored);
    }

    let signing_key = SigningKey::generate(&mut OsRng);
    storage.set(&key, &B64.encode(signing_key.to_bytes()))?;
    let verifying_key = signing_key.verifying_key();
    Ok(IdentityKeyPair {
        signing_key,
        verifying_key,
    })
}

fn identity_from_seed_b64(seed_b64: &str) -> MobileResult<IdentityKeyPair> {
    let seed = B64
        .decode(seed_b64.trim())
        .map_err(|error| MobileError::crypto(format!("identity seed is not base64: {error}")))?;
    if seed.len() != 32 {
        return Err(MobileError::crypto(format!(
            "identity seed must be 32 bytes, got {}",
            seed.len()
        )));
    }
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&seed);
    let signing_key = SigningKey::from_bytes(&bytes);
    let verifying_key = signing_key.verifying_key();
    Ok(IdentityKeyPair {
        signing_key,
        verifying_key,
    })
}

fn identity_key(user_scope: &str, actor_ptid: &str) -> String {
    format!(
        "{KEY_PREFIX}.v{STORE_VERSION}.identity.{}",
        scoped_hash(user_scope, actor_ptid)
    )
}

fn scoped_hash(user_scope: &str, actor_ptid: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(user_scope.as_bytes());
    hasher.update([0x1f]);
    hasher.update(actor_ptid.as_bytes());
    let digest = hasher.finalize();
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
