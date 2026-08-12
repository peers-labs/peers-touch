//! Recovery phrase generation and validation.
//!
//! The recovery secret is a BIP39 24-word mnemonic (256 bits of entropy).
//! It is used only to derive the backup key and is never persisted.

use bip39::{Language, Mnemonic};

use super::error::CryptoError;

// ---------------------------------------------------------------------------
// Mnemonic generation
// ---------------------------------------------------------------------------

/// Generate a new 24-word BIP39 mnemonic (256 bits of entropy).
pub fn generate_recovery_mnemonic() -> Result<String, CryptoError> {
    let mnemonic = Mnemonic::generate_in(Language::English, 24)
        .map_err(|e| CryptoError::InternalError(format!("mnemonic generation failed: {e}")))?;
    Ok(mnemonic.to_string())
}

/// Validate that a user-provided mnemonic is a valid BIP39 24-word phrase.
pub fn validate_mnemonic(phrase: &str) -> Result<(), CryptoError> {
    let words: Vec<&str> = phrase.split_whitespace().collect();
    if words.len() != 24 {
        return Err(CryptoError::MnemonicInvalid(format!(
            "expected 24 words, got {}",
            words.len()
        )));
    }
    Mnemonic::parse_in(Language::English, phrase)
        .map_err(|e| CryptoError::MnemonicInvalid(e.to_string()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_valid_mnemonic() {
        let mnemonic = generate_recovery_mnemonic().expect("generate");
        let words: Vec<&str> = mnemonic.split_whitespace().collect();
        assert_eq!(words.len(), 24);
        validate_mnemonic(&mnemonic).expect("should be valid");
    }

    #[test]
    fn invalid_mnemonic_rejected() {
        assert!(validate_mnemonic("not a valid mnemonic").is_err());
        assert!(validate_mnemonic("").is_err());
    }
}
