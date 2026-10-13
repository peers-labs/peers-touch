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

fn identity_migration_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
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
    identity_file_root().get().map(|root| {
        root.join("identity-keys")
            .join(identity_key_file_name(identity_key_ref))
    })
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

enum IdentitySeedResolution {
    KeepCanonical([u8; 32]),
    PersistCanonical([u8; 32]),
    GenerateCanonical,
}

impl std::fmt::Debug for IdentitySeedResolution {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::KeepCanonical(_) => "KeepCanonical",
            Self::PersistCanonical(_) => "PersistCanonical",
            Self::GenerateCanonical => "GenerateCanonical",
        })
    }
}

impl PartialEq for IdentitySeedResolution {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::KeepCanonical(left), Self::KeepCanonical(right))
            | (Self::PersistCanonical(left), Self::PersistCanonical(right)) => left == right,
            (Self::GenerateCanonical, Self::GenerateCanonical) => true,
            _ => false,
        }
    }
}

impl Eq for IdentitySeedResolution {}

fn identity_seed_fingerprint(seed: &[u8; 32]) -> [u8; 32] {
    Sha256::digest(IdentityKeyPair::from_seed(seed).verifying_key().as_bytes()).into()
}

fn select_identity_seed(
    canonical_seed: Option<[u8; 32]>,
    legacy_seeds: &[[u8; 32]],
    expected_fingerprint: Option<&[u8; 32]>,
) -> Result<IdentitySeedResolution, CryptoError> {
    let mut unique_legacy_seeds = Vec::new();
    for seed in legacy_seeds {
        if !unique_legacy_seeds.contains(seed) {
            unique_legacy_seeds.push(*seed);
        }
    }

    if let Some(expected_fingerprint) = expected_fingerprint {
        if canonical_seed
            .as_ref()
            .is_some_and(|seed| identity_seed_fingerprint(seed) == *expected_fingerprint)
        {
            return Ok(IdentitySeedResolution::KeepCanonical(
                canonical_seed.expect("checked canonical seed"),
            ));
        }
        let matching_legacy = unique_legacy_seeds
            .into_iter()
            .filter(|seed| identity_seed_fingerprint(seed) == *expected_fingerprint)
            .collect::<Vec<_>>();
        return match matching_legacy.as_slice() {
            [seed] => Ok(IdentitySeedResolution::PersistCanonical(*seed)),
            [] => Err(CryptoError::IdentityContinuityConflict(
                "no local identity seed matches the Station continuity record".to_string(),
            )),
            _ => Err(CryptoError::IdentityContinuityConflict(
                "multiple local identity seeds match the Station continuity record".to_string(),
            )),
        };
    }

    if let Some(canonical_seed) = canonical_seed {
        if unique_legacy_seeds
            .iter()
            .all(|legacy_seed| *legacy_seed == canonical_seed)
        {
            return Ok(IdentitySeedResolution::KeepCanonical(canonical_seed));
        }
        return Err(CryptoError::IdentityContinuityConflict(
            "canonical and legacy identity seeds disagree without a Station continuity record"
                .to_string(),
        ));
    }

    match unique_legacy_seeds.as_slice() {
        [] => Ok(IdentitySeedResolution::GenerateCanonical),
        [seed] => Ok(IdentitySeedResolution::PersistCanonical(*seed)),
        _ => Err(CryptoError::IdentityContinuityConflict(
            "legacy identity seeds disagree without a Station continuity record".to_string(),
        )),
    }
}

pub fn get_or_migrate_identity(
    canonical_identity_key_ref: &str,
    legacy_identity_key_refs: &[String],
    expected_fingerprint: Option<&[u8; 32]>,
) -> Result<IdentityKeyPair, CryptoError> {
    let _migration = identity_migration_lock()
        .lock()
        .map_err(|_| CryptoError::InternalError("identity migration lock poisoned".to_string()))?;
    let canonical_seed =
        load_identity_key(canonical_identity_key_ref)?.map(|identity| identity.seed_bytes());
    if let Some(canonical_seed) = canonical_seed {
        if expected_fingerprint
            .map(|expected| identity_seed_fingerprint(&canonical_seed) == *expected)
            .unwrap_or(true)
        {
            return Ok(IdentityKeyPair::from_seed(&canonical_seed));
        }
    }
    let mut legacy_seeds = Vec::new();
    for legacy_identity_key_ref in legacy_identity_key_refs {
        if legacy_identity_key_ref == canonical_identity_key_ref {
            continue;
        }
        if let Some(identity) = load_identity_key(legacy_identity_key_ref)? {
            legacy_seeds.push(identity.seed_bytes());
        }
    }

    match select_identity_seed(canonical_seed, &legacy_seeds, expected_fingerprint)? {
        IdentitySeedResolution::KeepCanonical(seed) => Ok(IdentityKeyPair::from_seed(&seed)),
        IdentitySeedResolution::PersistCanonical(seed) => {
            let seed = Zeroizing::new(seed);
            store_identity_key(canonical_identity_key_ref, &seed)?;
            Ok(IdentityKeyPair::from_seed(&seed))
        }
        IdentitySeedResolution::GenerateCanonical => {
            let identity = IdentityKeyPair::generate();
            let seed = Zeroizing::new(identity.seed_bytes());
            store_identity_key(canonical_identity_key_ref, &seed)?;
            Ok(identity)
        }
    }
}

pub fn get_or_create_identity(identity_key_ref: &str) -> Result<IdentityKeyPair, CryptoError> {
    get_or_migrate_identity(identity_key_ref, &[], None)
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

    fn seed_fingerprint(seed: &[u8; 32]) -> [u8; 32] {
        Sha256::digest(IdentityKeyPair::from_seed(seed).verifying_key().as_bytes()).into()
    }

    #[test]
    fn identity_scope_migration_persists_legacy_seed_when_canonical_is_missing() {
        let legacy_seed = [7u8; 32];

        assert_eq!(
            select_identity_seed(None, &[legacy_seed], None).unwrap(),
            IdentitySeedResolution::PersistCanonical(legacy_seed),
        );
    }

    #[test]
    fn identity_scope_migration_repairs_bug_generated_canonical_from_station_continuity() {
        let canonical_seed = [9u8; 32];
        let legacy_seed = [7u8; 32];
        let station_fingerprint = seed_fingerprint(&legacy_seed);

        assert_eq!(
            select_identity_seed(
                Some(canonical_seed),
                &[legacy_seed],
                Some(&station_fingerprint),
            )
            .unwrap(),
            IdentitySeedResolution::PersistCanonical(legacy_seed),
        );
    }

    #[test]
    fn identity_scope_migration_never_overwrites_station_matching_canonical_seed() {
        let canonical_seed = [9u8; 32];
        let legacy_seed = [7u8; 32];
        let station_fingerprint = seed_fingerprint(&canonical_seed);

        assert_eq!(
            select_identity_seed(
                Some(canonical_seed),
                &[legacy_seed],
                Some(&station_fingerprint),
            )
            .unwrap(),
            IdentitySeedResolution::KeepCanonical(canonical_seed),
        );
    }

    #[test]
    fn identity_scope_migration_rejects_unanchored_conflicting_seeds() {
        let error = select_identity_seed(Some([9u8; 32]), &[[7u8; 32]], None)
            .expect_err("conflicting seeds require Station continuity");

        assert!(matches!(error, CryptoError::IdentityContinuityConflict(_)));
    }

    #[test]
    fn identity_scope_migration_rejects_generation_when_station_continuity_exists() {
        let station_fingerprint = seed_fingerprint(&[7u8; 32]);
        let error = select_identity_seed(None, &[], Some(&station_fingerprint))
            .expect_err("established Station continuity requires its local seed");

        assert!(matches!(error, CryptoError::IdentityContinuityConflict(_)));
    }

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
