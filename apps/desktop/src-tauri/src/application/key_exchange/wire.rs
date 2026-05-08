use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hex;
use sha2::{Digest, Sha256};

/// Lowercase hex SHA-256 over the raw Ed25519 verifying key bytes (matches Go Station +
/// `identity_fingerprint_hex` in the Rust crypto layer).
pub fn identity_fingerprint_hex(ik_pub_b64: &str) -> String {
    let raw = match B64.decode(ik_pub_b64.trim()) {
        Ok(b) => b,
        Err(_) => return String::new(),
    };
    hex::encode(Sha256::digest(&raw))
}
