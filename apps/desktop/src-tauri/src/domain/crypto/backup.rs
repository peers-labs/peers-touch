//! Argon2id key derivation for canonical Messaging recovery archives.

use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};

use super::error::CryptoError;

pub const ARGON2_MEMORY_COST_KIB: u32 = 65_536;
pub const ARGON2_TIME_COST: u32 = 3;
pub const ARGON2_PARALLELISM: u32 = 1;
pub const BACKUP_KEY_BYTES: usize = 32;
pub const BACKUP_SALT_BYTES: usize = 16;
pub const BACKUP_NONCE_BYTES: usize = 12;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupKdfParameters {
    pub salt: Vec<u8>,
    pub memory_cost_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
    pub output_length: u32,
}

pub fn derive_backup_key(
    recovery_phrase: &[u8],
    kdf: &BackupKdfParameters,
) -> Result<[u8; BACKUP_KEY_BYTES], CryptoError> {
    if kdf.salt.len() != BACKUP_SALT_BYTES
        || kdf.memory_cost_kib != ARGON2_MEMORY_COST_KIB
        || kdf.time_cost != ARGON2_TIME_COST
        || kdf.parallelism != ARGON2_PARALLELISM
        || kdf.output_length != BACKUP_KEY_BYTES as u32
    {
        return Err(CryptoError::BackupDerivationFailed(
            "unsupported backup KDF parameters".into(),
        ));
    }
    let params = Params::new(
        kdf.memory_cost_kib,
        kdf.time_cost,
        kdf.parallelism,
        Some(kdf.output_length as usize),
    )
    .map_err(|error| CryptoError::BackupDerivationFailed(error.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0_u8; BACKUP_KEY_BYTES];
    argon2
        .hash_password_into(recovery_phrase, &kdf.salt, &mut key)
        .map_err(|error| CryptoError::BackupDerivationFailed(error.to_string()))?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_noncanonical_kdf_parameters() {
        let mut parameters = BackupKdfParameters {
            salt: vec![1; BACKUP_SALT_BYTES],
            memory_cost_kib: ARGON2_MEMORY_COST_KIB,
            time_cost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
            output_length: BACKUP_KEY_BYTES as u32,
        };
        parameters.time_cost += 1;
        assert!(derive_backup_key(b"recovery phrase", &parameters).is_err());
    }
}
