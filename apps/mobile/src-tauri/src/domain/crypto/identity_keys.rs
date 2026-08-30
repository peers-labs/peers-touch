use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use curve25519_dalek::edwards::CompressedEdwardsY;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;

const KEY_PREFIX: &str = "mobile-crypto-identity";
const STORE_VERSION: u32 = 1;

pub struct IdentityKeyPair {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
}

pub struct X25519KeyPair {
    pub private: StaticSecret,
    pub public: PublicKey,
}

pub struct LocalKeyBundle {
    pub device_id: String,
    pub ik_pub: String,
    pub spk_id: i32,
    pub spk_pub: String,
    pub spk_sig: String,
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

pub fn ensure_key_bundle(
    storage: &SecureStorage,
    user_scope: &str,
    actor_ptid: &str,
) -> MobileResult<LocalKeyBundle> {
    let identity = ensure_identity(storage, user_scope, actor_ptid)?;
    let device_id = ensure_device_id(storage, user_scope, actor_ptid)?;

    let spk_key = signed_prekey_key(user_scope, actor_ptid);
    let spk_secret = if let Some(stored) = storage.get(&spk_key)? {
        static_secret_from_b64(&stored, "signed prekey")?
    } else {
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        storage.set(&spk_key, &B64.encode(seed))?;
        StaticSecret::from(seed)
    };
    let spk_pub = PublicKey::from(&spk_secret);
    let signature = identity.signing_key.sign(spk_pub.as_bytes());

    Ok(LocalKeyBundle {
        device_id,
        ik_pub: B64.encode(identity.verifying_key.to_bytes()),
        spk_id: 1,
        spk_pub: B64.encode(spk_pub.as_bytes()),
        spk_sig: B64.encode(signature.to_bytes()),
    })
}

pub fn local_identity_x25519(
    storage: &SecureStorage,
    user_scope: &str,
    actor_ptid: &str,
) -> MobileResult<X25519KeyPair> {
    let identity = ensure_identity(storage, user_scope, actor_ptid)?;
    let seed = identity.signing_key.to_bytes();
    let private = StaticSecret::from(seed);
    let public = PublicKey::from(&private);
    Ok(X25519KeyPair { private, public })
}

pub fn peer_x25519_pub_from_ed25519(label: &str, ed_pub_b64: &str) -> MobileResult<PublicKey> {
    let raw = B64.decode(ed_pub_b64.trim()).map_err(|error| {
        MobileError::invalid_input(format!("invalid base64 for {label}: {error}"))
    })?;
    if raw.len() != 32 {
        return Err(MobileError::invalid_input(format!(
            "{label} must decode to 32 bytes, got {}",
            raw.len()
        )));
    }

    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&raw);
    let verifying = VerifyingKey::from_bytes(&bytes).map_err(|error| {
        MobileError::invalid_input(format!(
            "{label} is not a valid Ed25519 public key: {error}"
        ))
    })?;
    ed25519_verifying_to_x25519_public(&verifying).map_err(|reason| {
        MobileError::invalid_input(format!(
            "{label}: Ed25519 to X25519 conversion failed: {reason}"
        ))
    })
}

pub fn identity_fingerprint_hex(ik_pub_b64: &str) -> String {
    let raw = B64.decode(ik_pub_b64.trim()).unwrap_or_default();
    let digest = Sha256::digest(raw);
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn ensure_device_id(
    storage: &SecureStorage,
    user_scope: &str,
    actor_ptid: &str,
) -> MobileResult<String> {
    let key = device_id_key(user_scope, actor_ptid);
    if let Some(stored) = storage.get(&key)? {
        let value = stored.trim().to_string();
        if !value.is_empty() {
            return Ok(value);
        }
    }

    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    let value = format!(
        "mobile-{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    storage.set(&key, &value)?;
    Ok(value)
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

fn static_secret_from_b64(value: &str, label: &str) -> MobileResult<StaticSecret> {
    let decoded = B64
        .decode(value.trim())
        .map_err(|error| MobileError::crypto(format!("{label} is not base64: {error}")))?;
    if decoded.len() != 32 {
        return Err(MobileError::crypto(format!(
            "{label} must be 32 bytes, got {}",
            decoded.len()
        )));
    }
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&decoded);
    Ok(StaticSecret::from(bytes))
}

fn ed25519_verifying_to_x25519_public(verifying_key: &VerifyingKey) -> Result<PublicKey, String> {
    let bytes = verifying_key.to_bytes();
    let comp = CompressedEdwardsY(bytes);
    let edwards = comp
        .decompress()
        .ok_or_else(|| "invalid Ed25519 public key".to_string())?;
    Ok(PublicKey::from(edwards.to_montgomery().to_bytes()))
}

fn identity_key(user_scope: &str, actor_ptid: &str) -> String {
    format!(
        "{KEY_PREFIX}.v{STORE_VERSION}.identity.{}",
        scoped_hash(user_scope, actor_ptid)
    )
}

fn signed_prekey_key(user_scope: &str, actor_ptid: &str) -> String {
    format!(
        "{KEY_PREFIX}.v{STORE_VERSION}.spk.{}",
        scoped_hash(user_scope, actor_ptid)
    )
}

fn device_id_key(user_scope: &str, actor_ptid: &str) -> String {
    format!(
        "{KEY_PREFIX}.v{STORE_VERSION}.device.{}",
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
