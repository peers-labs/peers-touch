//! Typed error enum for the crypto domain.
//!
//! Every public function in this module returns `Result<T, CryptoError>`.
//! Errors carry enough context for upstream logging without leaking
//! secret material.

use std::fmt;

/// Unified error type for all crypto domain operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CryptoError {
    // --- Identity & key management ---
    /// OS keyring access failed (store or load).
    KeyringAccess(String),
    /// Identity key not found for the given reference.
    IdentityNotFound(String),
    /// Stored key material has an invalid format (corrupt or tampered).
    InvalidKeyFormat(String),
    /// Ed25519 signature verification failed.
    SignatureVerification(String),
    /// Ed25519 to X25519 conversion failed (invalid point).
    KeyConversion(String),

    // --- X3DH ---
    /// SPK signature on the peer's key bundle did not verify.
    X3dhSpkSignatureInvalid,
    /// The peer's key bundle is malformed or missing required fields.
    X3dhBundleMalformed(String),
    /// HKDF expansion failed during X3DH derivation.
    X3dhDerivationFailed,

    // --- Double Ratchet ---
    /// Message counter would skip more than the allowed maximum.
    RatchetSkipTooFar,
    /// Total stored skipped-message keys exceeds the safety budget.
    RatchetSkipBudgetExhausted,
    /// AEAD authentication failure (wrong key, tampered ciphertext, or AAD mismatch).
    RatchetAeadFailure,
    /// Wire format version is unsupported or fields are malformed.
    RatchetBadWireFormat(String),
    /// Attempted to receive on a session that has not yet been initialized.
    RatchetUninitializedReceive,
    /// Message counter regressed (replay or duplicate).
    RatchetCounterRegression,

    // --- Session management ---
    /// No session exists for the given (peer, device) pair.
    SessionNotFound(String),
    /// Session is in a state that does not permit the requested operation.
    SessionStateInvalid(String),

    // --- Device registry ---
    /// Peer device list is unavailable or stale beyond tolerance.
    DeviceListUnavailable(String),

    // --- Backup & recovery ---
    /// Argon2id key derivation failed.
    BackupDerivationFailed(String),
    /// Backup blob decryption failed (wrong passphrase or corrupt data).
    BackupDecryptionFailed,
    /// BIP39 mnemonic is invalid (wrong word count, checksum, or unknown word).
    MnemonicInvalid(String),

    // --- Multi-device ---
    /// Self-echo delivery to own devices failed.
    MultiDeviceFanOutFailed(String),

    // --- Generic ---
    /// An internal invariant was violated. Should never occur in production.
    InternalError(String),
    /// Filesystem I/O error while accessing key material.
    IoError(String),
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::KeyringAccess(ctx) => write!(f, "keyring access failed: {ctx}"),
            Self::IdentityNotFound(r) => write!(f, "identity not found for ref: {r}"),
            Self::InvalidKeyFormat(d) => write!(f, "invalid key format: {d}"),
            Self::SignatureVerification(d) => write!(f, "signature verification failed: {d}"),
            Self::KeyConversion(d) => write!(f, "key conversion failed: {d}"),
            Self::X3dhSpkSignatureInvalid => write!(f, "X3DH: SPK signature invalid"),
            Self::X3dhBundleMalformed(d) => write!(f, "X3DH: bundle malformed: {d}"),
            Self::X3dhDerivationFailed => write!(f, "X3DH: HKDF derivation failed"),
            Self::RatchetSkipTooFar => write!(f, "DR: skip too far"),
            Self::RatchetSkipBudgetExhausted => write!(f, "DR: skipped-key budget exhausted"),
            Self::RatchetAeadFailure => write!(f, "DR: AEAD authentication failed"),
            Self::RatchetBadWireFormat(d) => write!(f, "DR: bad wire format: {d}"),
            Self::RatchetUninitializedReceive => write!(f, "DR: session not initialized"),
            Self::RatchetCounterRegression => write!(f, "DR: counter regression (replay)"),
            Self::SessionNotFound(id) => write!(f, "session not found: {id}"),
            Self::SessionStateInvalid(d) => write!(f, "session state invalid: {d}"),
            Self::DeviceListUnavailable(d) => write!(f, "device list unavailable: {d}"),
            Self::BackupDerivationFailed(d) => write!(f, "backup key derivation failed: {d}"),
            Self::BackupDecryptionFailed => write!(f, "backup decryption failed"),
            Self::MnemonicInvalid(d) => write!(f, "mnemonic invalid: {d}"),
            Self::MultiDeviceFanOutFailed(d) => write!(f, "multi-device fan-out failed: {d}"),
            Self::InternalError(d) => write!(f, "internal crypto error: {d}"),
            Self::IoError(d) => write!(f, "I/O error: {d}"),
        }
    }
}

impl std::error::Error for CryptoError {}

impl From<std::io::Error> for CryptoError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}
