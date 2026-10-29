use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

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

pub(crate) fn replace_identity_seed(
    storage: &SecureStorage,
    user_scope: &str,
    actor_ptid: &str,
    seed: &[u8; 32],
) -> MobileResult<Option<Zeroizing<[u8; 32]>>> {
    let key = identity_key(user_scope, actor_ptid);
    let previous = storage
        .get(&key)?
        .map(|stored| identity_seed_from_b64(&stored))
        .transpose()?
        .map(Zeroizing::new);
    storage.set(&key, &B64.encode(seed))?;
    Ok(previous)
}

pub(crate) fn existing_identity(
    storage: &SecureStorage,
    user_scope: &str,
    actor_ptid: &str,
) -> MobileResult<Option<IdentityKeyPair>> {
    storage.get(&identity_key(user_scope, actor_ptid))?
        .map(|stored| identity_from_seed_b64(&stored)).transpose()
}

/// Import only if absent or identical; cancellation never replaces an account's
/// established E2EE identity.
pub(crate) fn import_linked_identity(
    storage: &SecureStorage,
    user_scope: &str,
    actor_ptid: &str,
    seed: &[u8; 32],
) -> MobileResult<()> {
    if let Some(existing) = existing_identity(storage, user_scope, actor_ptid)? {
        if existing.signing_key.to_bytes() != *seed {
            return Err(MobileError::crypto("deviceLink.identityConflict"));
        }
        return Ok(());
    }
    let encoded = Zeroizing::new(B64.encode(seed));
    storage.set(&identity_key(user_scope, actor_ptid), &encoded)?;
    let recovered = existing_identity(storage, user_scope, actor_ptid)?
        .ok_or_else(|| MobileError::crypto("deviceLink.identityPersistenceFailed"))?;
    if recovered.signing_key.to_bytes() != *seed {
        return Err(MobileError::crypto("deviceLink.identityPersistenceFailed"));
    }
    Ok(())
}

pub(crate) fn restore_identity_seed(
    storage: &SecureStorage,
    user_scope: &str,
    actor_ptid: &str,
    seed: Option<&[u8; 32]>,
) -> MobileResult<()> {
    let key = identity_key(user_scope, actor_ptid);
    match seed {
        Some(seed) => storage.set(&key, &B64.encode(seed))?,
        None => storage.remove(&key)?,
    }
    Ok(())
}

fn identity_from_seed_b64(seed_b64: &str) -> MobileResult<IdentityKeyPair> {
    let bytes = identity_seed_from_b64(seed_b64)?;
    let signing_key = SigningKey::from_bytes(&bytes);
    let verifying_key = signing_key.verifying_key();
    Ok(IdentityKeyPair {
        signing_key,
        verifying_key,
    })
}

fn identity_seed_from_b64(seed_b64: &str) -> MobileResult<[u8; 32]> {
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
    Ok(bytes)
}

/// Acceptance-only: install a parent-provisioned actor identity seed before
/// the first Session scope exists. Preset-identity harnesses own the seed and
/// address the record by its scoped hash, so the namespace owner validates the
/// record shape instead of deriving it from a live scope. Persistence is
/// verified by read-back; production identity derivation never takes this
/// path.
#[cfg(feature = "acceptance-harness")]
pub(crate) fn acceptance_replace_identity_seed(
    storage: &SecureStorage,
    storage_key: &str,
    seed_b64: &str,
) -> MobileResult<()> {
    if !is_identity_storage_key_shape(storage_key) {
        return Err(MobileError::invalid_input(
            "acceptance actor identity storage key has an invalid shape",
        ));
    }
    let seed = identity_seed_from_b64(seed_b64)?;
    storage.set(storage_key, &B64.encode(seed))?;
    let persisted = storage.get(storage_key)?.ok_or_else(|| {
        MobileError::crypto("acceptance actor identity seed was not persisted")
    })?;
    if identity_seed_from_b64(&persisted)? != seed {
        return Err(MobileError::crypto(
            "acceptance actor identity seed read-back mismatch",
        ));
    }
    Ok(())
}

fn is_identity_storage_key_shape(key: &str) -> bool {
    let prefix = format!("{KEY_PREFIX}.v{STORE_VERSION}.identity.");
    let Some(digest) = key.strip_prefix(prefix.as_str()) else {
        return false;
    };
    digest.len() == 32
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_storage_key_shape_accepts_derived_and_preset_keys() {
        let valid_digest = "0123456789abcdef0123456789abcdef";
        let valid_key = format!("{KEY_PREFIX}.v{STORE_VERSION}.identity.{valid_digest}");
        assert!(is_identity_storage_key_shape(&valid_key));
        assert!(is_identity_storage_key_shape(&identity_key(
            "station-peer|ptid:actor",
            "ptid:actor"
        )));
    }

    #[test]
    fn identity_storage_key_shape_rejects_foreign_or_malformed_keys() {
        let valid_digest = "0123456789abcdef0123456789abcdef";
        let base = format!("{KEY_PREFIX}.v{STORE_VERSION}.identity.{valid_digest}");

        assert!(!is_identity_storage_key_shape("mobile.storage.smoke"));
        assert!(!is_identity_storage_key_shape(&format!(
            "{KEY_PREFIX}.v2.identity.{valid_digest}"
        )));
        assert!(!is_identity_storage_key_shape(&format!(
            "{KEY_PREFIX}.v{STORE_VERSION}.identity.0123456789ABCDEF0123456789ABCDEF"
        )));
        assert!(!is_identity_storage_key_shape(&format!("{base}ff")));
        assert!(!is_identity_storage_key_shape(
            &base[..base.len() - 1]
        ));
        assert!(!is_identity_storage_key_shape(""));
    }
}
