pub use messaging_core::crypto::identity::{
    fingerprint_hex, fingerprint_numeric, DeviceSigningKey, IdentityKeyPair, X25519KeyPair,
};

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use ed25519_dalek::VerifyingKey;
use sha2::{Digest, Sha256};
use x25519_dalek::PublicKey as X25519Public;
use zeroize::Zeroizing;

use super::error::CryptoError;

pub fn ed25519_verifying_to_x25519_public(
    verifying_key: &VerifyingKey,
) -> Result<X25519Public, CryptoError> {
    messaging_core::crypto::identity::ed25519_verifying_to_x25519_public(verifying_key)
        .map_err(|msg| CryptoError::KeyConversion(msg))
}

// ---------------------------------------------------------------------------
// OS keyring / filesystem persistence
// ---------------------------------------------------------------------------

const CRYPTO_SERVICE: &str = "peers-touch.desktop.crypto";
const ACTOR_IDENTITY_ROOT_ENV: &str = "PEERS_ACTOR_IDENTITY_ROOT";
const STORAGE_ROOT_ENV: &str = "PEERS_STORAGE_ROOT";

fn identity_file_root() -> &'static OnceLock<PathBuf> {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    &ROOT
}

/// Configure the directory for file-backed identity seeds. Called by the
/// composition root (which can resolve the OS data dir) so this domain module
/// never has to depend on the infrastructure layer. Debug builds use it to keep
/// identity keys in a 0600 file instead of the OS keychain, avoiding repeated
/// keychain prompts caused by recompilation changing the code signature.
pub fn set_identity_file_root(root: PathBuf) -> Result<(), CryptoError> {
    identity_file_root()
        .set(root)
        .map_err(|_| CryptoError::IoError("identity file root already configured".to_string()))
}

fn identity_cache() -> &'static Mutex<HashMap<String, Zeroizing<[u8; 32]>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Zeroizing<[u8; 32]>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn identity_key_file_name(identity_key_ref: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(identity_key_ref.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn scoped_identity_file(identity_key_ref: &str) -> Option<PathBuf> {
    let root = std::env::var(ACTOR_IDENTITY_ROOT_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var(STORAGE_ROOT_ENV).ok())?;
    let root = root.trim();
    if root.is_empty() {
        return None;
    }
    Some(
        PathBuf::from(root)
            .join("peers-touch")
            .join("desktop")
            .join("data")
            .join("secure-store")
            .join("identity-keys")
            .join(identity_key_file_name(identity_key_ref)),
    )
}

/// Resolved file location for an identity seed: explicit env root first, then
/// the composition-root-provided debug store. None means use the OS keyring.
fn identity_file(identity_key_ref: &str) -> Option<PathBuf> {
    if let Some(path) = scoped_identity_file(identity_key_ref) {
        return Some(path);
    }
    identity_file_root()
        .get()
        .map(|root| root.join("identity-keys").join(identity_key_file_name(identity_key_ref)))
}

fn keyring_entry(identity_key_ref: &str) -> Result<keyring::Entry, CryptoError> {
    let user = format!("identity-key:{identity_key_ref}");
    keyring::Entry::new(CRYPTO_SERVICE, &user)
        .map_err(|e| CryptoError::KeyringAccess(e.to_string()))
}

#[cfg(unix)]
fn harden_path(path: &Path) -> Result<(), CryptoError> {
    use std::os::unix::fs::PermissionsExt;
    if let Some(parent) = path.parent() {
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|e| CryptoError::IoError(e.to_string()))?;
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|e| CryptoError::IoError(e.to_string()))
}

#[cfg(not(unix))]
fn harden_path(_path: &Path) -> Result<(), CryptoError> {
    Ok(())
}

fn load_scoped_identity_key(
    identity_key_ref: &str,
    path: &Path,
) -> Result<Option<IdentityKeyPair>, CryptoError> {
    match fs::read_to_string(path) {
        Ok(content) => {
            let content = Zeroizing::new(content);
            harden_path(path)?;
            parse_hex_seed(identity_key_ref, content.trim())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(CryptoError::IoError(error.to_string())),
    }
}

pub fn store_identity_key(identity_key_ref: &str, seed: &[u8; 32]) -> Result<(), CryptoError> {
    let hex_seed = Zeroizing::new(seed.iter().map(|b| format!("{b:02x}")).collect::<String>());

    if let Some(path) = identity_file(identity_key_ref) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| CryptoError::IoError(e.to_string()))?;
        }
        fs::write(&path, hex_seed.as_str()).map_err(|e| CryptoError::IoError(e.to_string()))?;
        harden_path(&path)?;
        if let Ok(mut cache) = identity_cache().lock() {
            cache.insert(identity_key_ref.to_string(), Zeroizing::new(*seed));
        }
        return Ok(());
    }

    let entry = keyring_entry(identity_key_ref)?;
    entry
        .set_password(&hex_seed)
        .map_err(|e| CryptoError::KeyringAccess(e.to_string()))?;
    if let Ok(mut cache) = identity_cache().lock() {
        cache.insert(identity_key_ref.to_string(), Zeroizing::new(*seed));
    }
    Ok(())
}

fn load_keyring_identity(identity_key_ref: &str) -> Result<Option<IdentityKeyPair>, CryptoError> {
    let entry = keyring_entry(identity_key_ref)?;
    match entry.get_password() {
        Ok(password) => {
            let password = Zeroizing::new(password);
            parse_hex_seed(identity_key_ref, &password)
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(CryptoError::KeyringAccess(e.to_string())),
    }
}

pub fn load_identity_key(identity_key_ref: &str) -> Result<Option<IdentityKeyPair>, CryptoError> {
    if let Ok(cache) = identity_cache().lock() {
        if let Some(seed) = cache.get(identity_key_ref) {
            return Ok(Some(IdentityKeyPair::from_seed(&**seed)));
        }
    }

    if let Some(path) = identity_file(identity_key_ref) {
        match load_scoped_identity_key(identity_key_ref, &path)? {
            Some(kp) => return Ok(Some(kp)),
            None => {
                // First launch on the file store: migrate the existing keyring
                // seed once (a single prompt), then keep using the file.
                if let Some(kp) = load_keyring_identity(identity_key_ref)? {
                    let seed = Zeroizing::new(kp.seed_bytes());
                    store_identity_key(identity_key_ref, &seed)?;
                    return Ok(Some(kp));
                }
                return Ok(None);
            }
        }
    }

    load_keyring_identity(identity_key_ref)
}

pub fn get_or_create_identity(identity_key_ref: &str) -> Result<IdentityKeyPair, CryptoError> {
    if let Some(kp) = load_identity_key(identity_key_ref)? {
        return Ok(kp);
    }
    let kp = IdentityKeyPair::generate();
    let seed = Zeroizing::new(kp.seed_bytes());
    store_identity_key(identity_key_ref, &seed)?;
    Ok(kp)
}

pub fn delete_identity_key(identity_key_ref: &str) -> Result<(), CryptoError> {
    if let Ok(mut cache) = identity_cache().lock() {
        cache.remove(identity_key_ref);
    }
    if let Some(path) = identity_file(identity_key_ref) {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| CryptoError::IoError(e.to_string()))?;
        }
        return Ok(());
    }
    let entry = keyring_entry(identity_key_ref)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(CryptoError::KeyringAccess(e.to_string())),
    }
}

fn parse_hex_seed(
    identity_key_ref: &str,
    hex_str: &str,
) -> Result<Option<IdentityKeyPair>, CryptoError> {
    if hex_str.len() != 64 || !hex_str.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(CryptoError::InvalidKeyFormat(
            "stored identity key is not 64 hex chars".into(),
        ));
    }
    let mut seed = Zeroizing::new([0u8; 32]);
    for i in 0..32 {
        seed[i] = u8::from_str_radix(&hex_str[i * 2..i * 2 + 2], 16)
            .map_err(|_| CryptoError::InvalidKeyFormat("hex decode failed".into()))?;
    }
    if let Ok(mut cache) = identity_cache().lock() {
        cache.insert(identity_key_ref.to_string(), seed.clone());
    }
    Ok(Some(IdentityKeyPair::from_seed(&seed)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_keypair_round_trip() {
        let kp = IdentityKeyPair::generate();
        let seed = kp.seed_bytes();
        let restored = IdentityKeyPair::from_seed(&seed);
        assert_eq!(
            kp.verifying_key().as_bytes(),
            restored.verifying_key().as_bytes()
        );
    }

    #[test]
    fn missing_scoped_identity_does_not_fall_through_to_keyring() {
        let path = std::env::temp_dir()
            .join(format!("peers-touch-identity-test-{}", std::process::id()))
            .join("missing.key");

        assert!(load_scoped_identity_key("actor:test", &path)
            .expect("missing scoped identity")
            .is_none());
    }

    #[test]
    fn ed25519_to_x25519_consistency() {
        let kp = IdentityKeyPair::generate();
        let x_pub_from_priv = kp.to_x25519_public();
        let x_pub_from_vk =
            ed25519_verifying_to_x25519_public(kp.verifying_key()).expect("conversion");
        assert_eq!(x_pub_from_priv.as_bytes(), x_pub_from_vk.as_bytes());
    }

    #[test]
    fn device_signing_key_cross_signature_verifies() {
        use ed25519_dalek::Signer;
        let ik = IdentityKeyPair::generate();
        let certificate = b"canonical certificate";
        let dsk =
            DeviceSigningKey::generate_cross_signed(&ik, "device-001", |_| certificate.to_vec());
        assert!(dsk
            .verify_cross_signature(ik.verifying_key(), certificate)
            .is_ok());
    }

    #[test]
    fn device_signing_key_wrong_ik_fails() {
        let ik = IdentityKeyPair::generate();
        let other_ik = IdentityKeyPair::generate();
        let certificate = b"canonical certificate";
        let dsk =
            DeviceSigningKey::generate_cross_signed(&ik, "device-002", |_| certificate.to_vec());
        assert!(dsk
            .verify_cross_signature(other_ik.verifying_key(), certificate)
            .is_err());
    }

    #[test]
    fn fingerprint_is_deterministic() {
        let kp = IdentityKeyPair::generate();
        let fp1 = fingerprint_hex(kp.verifying_key());
        let fp2 = fingerprint_hex(kp.verifying_key());
        assert_eq!(fp1, fp2);
        assert_eq!(fp1.len(), 64);
    }

    #[test]
    fn safety_number_is_symmetric() {
        let a = IdentityKeyPair::generate();
        let b = IdentityKeyPair::generate();
        let sn_ab = fingerprint_numeric(a.verifying_key(), b.verifying_key());
        let sn_ba = fingerprint_numeric(b.verifying_key(), a.verifying_key());
        assert_eq!(sn_ab, sn_ba);
    }
}
