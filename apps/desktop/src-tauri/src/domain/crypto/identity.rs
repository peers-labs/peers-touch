//! Identity Key (IK) and Device Signing Key (DSK) management.
//!
//! - IK: Per-actor Ed25519 signing key. Stored in OS keyring (primary)
//!   with a filesystem fallback under `$PEERS_STORAGE_ROOT`. Also stored
//!   in the encrypted backup blob.
//! - DSK: Per-device Ed25519 signing key, cross-signed by IK to prove
//!   that the device belongs to the actor.
//!
//! All secret key bytes implement `Zeroize` on drop via wrapper types.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use keyring::Entry;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256, Sha512};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use x25519_dalek::{PublicKey as X25519Public, StaticSecret};
use zeroize::Zeroize;

use super::error::CryptoError;

// ---------------------------------------------------------------------------
// Key types
// ---------------------------------------------------------------------------

/// Ed25519 identity keypair. The signing key is zeroized on drop.
#[derive(Clone)]
pub struct IdentityKeyPair {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
}

impl Drop for IdentityKeyPair {
    fn drop(&mut self) {
        // SigningKey holds 32 secret bytes internally. We overwrite via
        // the public to_bytes → from_bytes round-trip with zeros.
        let mut zeros = [0u8; 32];
        self.signing_key = SigningKey::from_bytes(&zeros);
        zeros.zeroize();
    }
}

impl IdentityKeyPair {
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        Self {
            signing_key,
            verifying_key,
        }
    }

    pub fn from_seed(seed: &[u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(seed);
        let verifying_key = signing_key.verifying_key();
        Self {
            signing_key,
            verifying_key,
        }
    }

    pub fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }

    pub fn verifying_key(&self) -> &VerifyingKey {
        &self.verifying_key
    }

    pub fn seed_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }

    /// Sign arbitrary data with this identity key.
    pub fn sign(&self, msg: &[u8]) -> Signature {
        self.signing_key.sign(msg)
    }

    /// Derive the X25519 static secret from this Ed25519 signing key
    /// (Edwards → Montgomery conversion using SHA-512 clamping per RFC 8032).
    pub fn to_x25519_secret(&self) -> StaticSecret {
        let seed = self.signing_key.to_bytes();
        let digest = Sha512::digest(seed);
        let mut scalar = [0u8; 32];
        scalar.copy_from_slice(&digest[..32]);
        scalar[0] &= 248;
        scalar[31] &= 127;
        scalar[31] |= 64;
        StaticSecret::from(scalar)
    }

    /// X25519 public key derived from the identity key.
    pub fn to_x25519_public(&self) -> X25519Public {
        X25519Public::from(&self.to_x25519_secret())
    }
}

/// Device Signing Key — per-device Ed25519, cross-signed by IK.
#[derive(Clone)]
pub struct DeviceSigningKey {
    signing_key: SigningKey,
    verifying_key: VerifyingKey,
    /// Signature of (device_verifying_key || device_id) by the actor's IK.
    cross_signature: Signature,
    device_id: String,
}

impl Drop for DeviceSigningKey {
    fn drop(&mut self) {
        let mut zeros = [0u8; 32];
        self.signing_key = SigningKey::from_bytes(&zeros);
        zeros.zeroize();
    }
}

impl DeviceSigningKey {
    /// Generate a new DSK and cross-sign it with the given identity key.
    pub fn generate(ik: &IdentityKeyPair, device_id: &str) -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        let cross_msg = Self::cross_sign_message(&verifying_key, device_id);
        let cross_signature = ik.sign(&cross_msg);
        Self {
            signing_key,
            verifying_key,
            cross_signature,
            device_id: device_id.to_string(),
        }
    }

    /// Reconstruct from stored components.
    pub fn from_parts(seed: &[u8; 32], cross_signature: Signature, device_id: String) -> Self {
        let signing_key = SigningKey::from_bytes(seed);
        let verifying_key = signing_key.verifying_key();
        Self {
            signing_key,
            verifying_key,
            cross_signature,
            device_id,
        }
    }

    pub fn verifying_key(&self) -> &VerifyingKey {
        &self.verifying_key
    }

    pub fn cross_signature(&self) -> &Signature {
        &self.cross_signature
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn sign(&self, msg: &[u8]) -> Signature {
        self.signing_key.sign(msg)
    }

    /// Verify that this DSK was genuinely cross-signed by the given IK.
    pub fn verify_cross_signature(&self, ik_verifying: &VerifyingKey) -> Result<(), CryptoError> {
        let msg = Self::cross_sign_message(&self.verifying_key, &self.device_id);
        ik_verifying
            .verify(&msg, &self.cross_signature)
            .map_err(|e| CryptoError::SignatureVerification(e.to_string()))
    }

    fn cross_sign_message(device_vk: &VerifyingKey, device_id: &str) -> Vec<u8> {
        let mut msg = Vec::with_capacity(32 + device_id.len() + 16);
        msg.extend_from_slice(b"peers-touch:dsk:v1:");
        msg.extend_from_slice(device_vk.as_bytes());
        msg.extend_from_slice(device_id.as_bytes());
        msg
    }
}

// ---------------------------------------------------------------------------
// X25519 keypair (used for SPK/OPK)
// ---------------------------------------------------------------------------

/// X25519 keypair with zeroize on drop for the private component.
pub struct X25519KeyPair {
    pub private: StaticSecret,
    pub public: X25519Public,
}

impl X25519KeyPair {
    pub fn generate() -> Self {
        let private = StaticSecret::random_from_rng(OsRng);
        let public = X25519Public::from(&private);
        Self { private, public }
    }

    pub fn from_private_bytes(bytes: [u8; 32]) -> Self {
        let private = StaticSecret::from(bytes);
        let public = X25519Public::from(&private);
        Self { private, public }
    }

    pub fn private(&self) -> &StaticSecret {
        &self.private
    }

    pub fn public(&self) -> &X25519Public {
        &self.public
    }

    pub fn private_bytes(&self) -> [u8; 32] {
        self.private.to_bytes()
    }

    pub fn public_bytes(&self) -> [u8; 32] {
        self.public.to_bytes()
    }
}

// ---------------------------------------------------------------------------
// Fingerprint computation
// ---------------------------------------------------------------------------

/// Compute the SHA-256 fingerprint of an Ed25519 verifying key (hex-encoded, 64 chars).
pub fn fingerprint_hex(verifying_key: &VerifyingKey) -> String {
    let mut h = Sha256::new();
    h.update(verifying_key.as_bytes());
    hex::encode(h.finalize())
}

/// Compute a human-readable fingerprint for safety-number comparison.
/// Returns a 60-digit numeric string grouped into 12 groups of 5 digits.
pub fn fingerprint_numeric(vk_a: &VerifyingKey, vk_b: &VerifyingKey) -> String {
    let mut h = Sha256::new();
    // Lexicographic ordering ensures both parties derive the same value.
    let (first, second) = if vk_a.as_bytes() <= vk_b.as_bytes() {
        (vk_a, vk_b)
    } else {
        (vk_b, vk_a)
    };
    h.update(b"peers-touch:safety-number:v1:");
    h.update(first.as_bytes());
    h.update(second.as_bytes());
    let digest = h.finalize();

    // Take 30 bytes (240 bits) and convert to 60 decimal digits via
    // chunking into 5-byte (40-bit) groups → each yields 5 digits.
    let mut digits = String::with_capacity(72);
    for (i, chunk) in digest[..30].chunks(5).enumerate() {
        let mut val: u64 = 0;
        for &b in chunk {
            val = (val << 8) | (b as u64);
        }
        let group = format!("{:05}", val % 100000);
        if i > 0 {
            digits.push(' ');
        }
        digits.push_str(&group);
    }
    digits
}

/// Convert an Ed25519 verifying key (Edwards form) to an X25519 public
/// key (Montgomery form) for use in DH computations.
pub fn ed25519_verifying_to_x25519_public(
    verifying_key: &VerifyingKey,
) -> Result<X25519Public, CryptoError> {
    use curve25519_dalek::edwards::CompressedEdwardsY;
    let bytes = verifying_key.to_bytes();
    let comp = CompressedEdwardsY(bytes);
    let edwards = comp.decompress().ok_or_else(|| {
        CryptoError::KeyConversion("cannot decompress Ed25519 point to Montgomery".into())
    })?;
    let mont = edwards.to_montgomery();
    Ok(X25519Public::from(mont.to_bytes()))
}

// ---------------------------------------------------------------------------
// OS keyring / filesystem persistence
// ---------------------------------------------------------------------------

const CRYPTO_SERVICE: &str = "peers-touch.desktop.crypto";

/// In-process cache of loaded identity seeds to avoid repeated keyring access.
fn identity_cache() -> &'static Mutex<HashMap<String, [u8; 32]>> {
    static CACHE: OnceLock<Mutex<HashMap<String, [u8; 32]>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Scoped file path for identity key storage when `PEERS_STORAGE_ROOT` is set.
fn scoped_identity_file(identity_key_ref: &str) -> Option<PathBuf> {
    let root = std::env::var("PEERS_STORAGE_ROOT").ok()?;
    let root = root.trim();
    if root.is_empty() {
        return None;
    }
    let mut hasher = Sha256::new();
    hasher.update(identity_key_ref.as_bytes());
    let digest = hasher.finalize();
    let name: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    Some(
        PathBuf::from(root)
            .join("peers-touch")
            .join("desktop")
            .join("data")
            .join("secure-store")
            .join("identity-keys")
            .join(format!("{name}.key")),
    )
}

fn keyring_entry(identity_key_ref: &str) -> Result<Entry, CryptoError> {
    let user = format!("identity-key:{identity_key_ref}");
    Entry::new(CRYPTO_SERVICE, &user).map_err(|e| CryptoError::KeyringAccess(e.to_string()))
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

/// Store an identity key seed. Prefers filesystem under `PEERS_STORAGE_ROOT`,
/// falls back to OS keyring.
pub fn store_identity_key(identity_key_ref: &str, seed: &[u8; 32]) -> Result<(), CryptoError> {
    let hex_seed: String = seed.iter().map(|b| format!("{b:02x}")).collect();

    if let Some(path) = scoped_identity_file(identity_key_ref) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| CryptoError::IoError(e.to_string()))?;
        }
        fs::write(&path, hex_seed.as_str()).map_err(|e| CryptoError::IoError(e.to_string()))?;
        harden_path(&path)?;
        if let Ok(mut cache) = identity_cache().lock() {
            cache.insert(identity_key_ref.to_string(), *seed);
        }
        return Ok(());
    }

    let entry = keyring_entry(identity_key_ref)?;
    entry
        .set_password(&hex_seed)
        .map_err(|e| CryptoError::KeyringAccess(e.to_string()))?;
    if let Ok(mut cache) = identity_cache().lock() {
        cache.insert(identity_key_ref.to_string(), *seed);
    }
    Ok(())
}

/// Load an identity keypair from cache, filesystem, or OS keyring.
/// Returns `Ok(None)` if no key exists yet.
pub fn load_identity_key(identity_key_ref: &str) -> Result<Option<IdentityKeyPair>, CryptoError> {
    // Check in-process cache first.
    if let Ok(cache) = identity_cache().lock() {
        if let Some(seed) = cache.get(identity_key_ref) {
            return Ok(Some(IdentityKeyPair::from_seed(seed)));
        }
    }

    // Try filesystem.
    if let Some(path) = scoped_identity_file(identity_key_ref) {
        match fs::read_to_string(&path) {
            Ok(content) => {
                harden_path(&path)?;
                return parse_hex_seed(identity_key_ref, content.trim());
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(CryptoError::IoError(e.to_string())),
        }
    }

    // Try OS keyring.
    let entry = keyring_entry(identity_key_ref)?;
    match entry.get_password() {
        Ok(pw) => parse_hex_seed(identity_key_ref, &pw),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(CryptoError::KeyringAccess(e.to_string())),
    }
}

/// Get or create the identity keypair for the given reference.
pub fn get_or_create_identity(identity_key_ref: &str) -> Result<IdentityKeyPair, CryptoError> {
    if let Some(kp) = load_identity_key(identity_key_ref)? {
        return Ok(kp);
    }
    let kp = IdentityKeyPair::generate();
    let seed = kp.seed_bytes();
    store_identity_key(identity_key_ref, &seed)?;
    Ok(kp)
}

/// Delete identity key from all storage locations.
pub fn delete_identity_key(identity_key_ref: &str) -> Result<(), CryptoError> {
    if let Ok(mut cache) = identity_cache().lock() {
        cache.remove(identity_key_ref);
    }
    if let Some(path) = scoped_identity_file(identity_key_ref) {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| CryptoError::IoError(e.to_string()))?;
        }
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
    let mut seed = [0u8; 32];
    for i in 0..32 {
        seed[i] = u8::from_str_radix(&hex_str[i * 2..i * 2 + 2], 16)
            .map_err(|_| CryptoError::InvalidKeyFormat("hex decode failed".into()))?;
    }
    if let Ok(mut cache) = identity_cache().lock() {
        cache.insert(identity_key_ref.to_string(), seed);
    }
    Ok(Some(IdentityKeyPair::from_seed(&seed)))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
    fn ed25519_to_x25519_consistency() {
        let kp = IdentityKeyPair::generate();
        let x_pub_from_priv = kp.to_x25519_public();
        let x_pub_from_vk =
            ed25519_verifying_to_x25519_public(kp.verifying_key()).expect("conversion");
        assert_eq!(x_pub_from_priv.as_bytes(), x_pub_from_vk.as_bytes());
    }

    #[test]
    fn device_signing_key_cross_signature_verifies() {
        let ik = IdentityKeyPair::generate();
        let dsk = DeviceSigningKey::generate(&ik, "device-001");
        assert!(dsk.verify_cross_signature(ik.verifying_key()).is_ok());
    }

    #[test]
    fn device_signing_key_wrong_ik_fails() {
        let ik = IdentityKeyPair::generate();
        let other_ik = IdentityKeyPair::generate();
        let dsk = DeviceSigningKey::generate(&ik, "device-002");
        assert!(dsk
            .verify_cross_signature(other_ik.verifying_key())
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
