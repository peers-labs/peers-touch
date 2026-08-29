//! PIN-based session protection: Argon2id key derivation + AES-256-GCM encryption.
//!
//! Security model:
//! - PIN → Argon2id(PIN, salt) → 32-byte derived key
//! - Session JWT encrypted with AES-256-GCM using the derived key
//! - Verification hash stored separately for quick rejection before decryption
//! - Lockout after consecutive failed attempts (cooldown enforced by caller)

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::password_hash::{rand_core::OsRng, PasswordHash, SaltString};
use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

const MAX_CONSECUTIVE_FAILURES: u32 = 5;
const LOCKOUT_DURATION_SECS: u64 = 300; // 5 minutes

/// Persisted alongside each account identity in `identities.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PinProtection {
    /// Argon2id PHC hash of the PIN for quick verification.
    pub verify_hash: String,
    /// Random salt (hex) used to derive the encryption key separately from the verify hash.
    pub enc_salt: String,
    /// Consecutive failed attempts counter.
    #[serde(default)]
    pub failed_attempts: u32,
    /// Unix timestamp of last failed attempt (for lockout window).
    #[serde(default)]
    pub last_failed_at: u64,
}

/// An encrypted session blob stored per account.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedSession {
    /// AES-256-GCM ciphertext (hex).
    pub ciphertext: String,
    /// 12-byte nonce (hex).
    pub nonce: String,
    /// Account ID used as AAD.
    pub account_id: String,
    /// Canonical Station actor from the encrypted JWT subject.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub actor_id: String,
}

/// Derive a 32-byte key from PIN + salt using Argon2id, for encrypting session data.
fn derive_encryption_key(pin: &str, salt_hex: &str) -> Result<[u8; 32], String> {
    let salt_bytes = hex::decode(salt_hex).map_err(|e| format!("bad enc_salt hex: {e}"))?;

    let argon2 = Argon2::default();
    let mut okm = [0u8; 32];
    argon2
        .hash_password_into(pin.as_bytes(), &salt_bytes, &mut okm)
        .map_err(|e| format!("argon2 key derivation failed: {e}"))?;
    Ok(okm)
}

/// Create PIN protection metadata: verify hash + encryption salt.
pub fn create_pin_protection(pin: &str) -> Result<PinProtection, String> {
    if pin.len() < 4 || pin.len() > 16 {
        return Err("PIN must be 4-16 characters".to_string());
    }

    let argon2 = Argon2::default();
    let salt = SaltString::generate(&mut OsRng);
    let verify_hash = argon2
        .hash_password(pin.as_bytes(), &salt)
        .map_err(|e| format!("failed to hash PIN: {e}"))?
        .to_string();

    let mut enc_salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut enc_salt);

    Ok(PinProtection {
        verify_hash,
        enc_salt: hex::encode(enc_salt),
        failed_attempts: 0,
        last_failed_at: 0,
    })
}

/// Verify a PIN against stored protection, returning Ok(()) or updating failure counters.
pub fn verify_pin(pin: &str, protection: &mut PinProtection) -> Result<(), PinVerifyError> {
    if protection.failed_attempts >= MAX_CONSECUTIVE_FAILURES {
        let now = now_epoch();
        let elapsed = now.saturating_sub(protection.last_failed_at);
        if elapsed < LOCKOUT_DURATION_SECS {
            let remaining = LOCKOUT_DURATION_SECS - elapsed;
            return Err(PinVerifyError::LockedOut {
                remaining_secs: remaining,
            });
        }
        protection.failed_attempts = 0;
    }

    let parsed_hash = PasswordHash::new(&protection.verify_hash)
        .map_err(|e| PinVerifyError::Internal(format!("corrupt verify hash: {e}")))?;

    let argon2 = Argon2::default();
    if argon2
        .verify_password(pin.as_bytes(), &parsed_hash)
        .is_err()
    {
        protection.failed_attempts += 1;
        protection.last_failed_at = now_epoch();
        return Err(PinVerifyError::WrongPin {
            attempts_remaining: MAX_CONSECUTIVE_FAILURES.saturating_sub(protection.failed_attempts),
        });
    }

    protection.failed_attempts = 0;
    Ok(())
}

/// Encrypt a session token with a PIN-derived key.
pub fn encrypt_session(
    pin: &str,
    enc_salt: &str,
    account_id: &str,
    actor_id: &str,
    plaintext_token: &str,
) -> Result<EncryptedSession, String> {
    let mut key = derive_encryption_key(pin, enc_salt)?;

    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext_token.as_bytes(),
                aad: account_id.as_bytes(),
            },
        )
        .map_err(|e| format!("AES-GCM encrypt failed: {e}"))?;

    key.zeroize();

    Ok(EncryptedSession {
        ciphertext: hex::encode(&ciphertext),
        nonce: hex::encode(nonce_bytes),
        account_id: account_id.to_string(),
        actor_id: actor_id.to_string(),
    })
}

/// Decrypt a session token with a PIN-derived key.
pub fn decrypt_session(
    pin: &str,
    enc_salt: &str,
    encrypted: &EncryptedSession,
) -> Result<String, String> {
    let mut key = derive_encryption_key(pin, enc_salt)?;

    let ciphertext =
        hex::decode(&encrypted.ciphertext).map_err(|e| format!("bad ciphertext hex: {e}"))?;
    let nonce_bytes = hex::decode(&encrypted.nonce).map_err(|e| format!("bad nonce hex: {e}"))?;
    if nonce_bytes.len() != 12 {
        return Err("nonce must be 12 bytes".to_string());
    }

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext.as_slice(),
                aad: encrypted.account_id.as_bytes(),
            },
        )
        .map_err(|_| "decryption failed: wrong PIN or corrupted data".to_string())?;

    key.zeroize();

    String::from_utf8(plaintext).map_err(|e| format!("decrypted token not valid UTF-8: {e}"))
}

/// Fingerprint for display: last 8 hex chars of SHA-256(account_id).
pub fn account_fingerprint(account_id: &str) -> String {
    let digest = Sha256::digest(account_id.as_bytes());
    let full = hex::encode(digest);
    full[full.len() - 8..].to_string()
}

#[derive(Debug)]
pub enum PinVerifyError {
    WrongPin { attempts_remaining: u32 },
    LockedOut { remaining_secs: u64 },
    Internal(String),
}

impl std::fmt::Display for PinVerifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PinVerifyError::WrongPin { attempts_remaining } => {
                write!(f, "wrong PIN ({attempts_remaining} attempts remaining)")
            }
            PinVerifyError::LockedOut { remaining_secs } => {
                write!(f, "account locked, retry in {remaining_secs}s")
            }
            PinVerifyError::Internal(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_create_verify_roundtrip() {
        let mut prot = create_pin_protection("123456").unwrap();
        assert!(verify_pin("123456", &mut prot).is_ok());
        assert!(verify_pin("000000", &mut prot).is_err());
    }

    #[test]
    fn session_encrypt_decrypt_roundtrip() {
        let prot = create_pin_protection("1234").unwrap();
        let token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig";
        let enc =
            encrypt_session("1234", &prot.enc_salt, "password:test", "actor-test", token).unwrap();
        let dec = decrypt_session("1234", &prot.enc_salt, &enc).unwrap();
        assert_eq!(dec, token);
    }

    #[test]
    fn session_decrypt_wrong_pin_fails() {
        let prot = create_pin_protection("1234").unwrap();
        let enc = encrypt_session(
            "1234",
            &prot.enc_salt,
            "password:test",
            "actor-test",
            "secret",
        )
        .unwrap();
        assert!(decrypt_session("9999", &prot.enc_salt, &enc).is_err());
    }

    #[test]
    fn lockout_after_max_failures() {
        let mut prot = create_pin_protection("1234").unwrap();
        for _ in 0..MAX_CONSECUTIVE_FAILURES {
            let _ = verify_pin("0000", &mut prot);
        }
        match verify_pin("0000", &mut prot) {
            Err(PinVerifyError::LockedOut { .. }) => {}
            other => panic!("expected LockedOut, got {other:?}"),
        }
    }
}
