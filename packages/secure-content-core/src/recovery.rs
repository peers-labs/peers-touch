use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop};

const RECOVERY_INFO: &[u8] = b"peers-touch:secure-content:recovery:v1";

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct RecoveryMaster([u8; 32]);

impl RecoveryMaster {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

pub fn derive_recovery_master(
    mnemonic_entropy: &[u8],
    actor_ptid: &str,
    recovery_epoch: u64,
) -> Result<RecoveryMaster, String> {
    if mnemonic_entropy.len() < 16 || actor_ptid.trim().is_empty() || recovery_epoch == 0 {
        return Err("secure content recovery input is invalid".to_string());
    }
    let mut salt_input = Vec::with_capacity(actor_ptid.len() + 8);
    salt_input.extend_from_slice(actor_ptid.as_bytes());
    salt_input.extend_from_slice(&recovery_epoch.to_be_bytes());
    let salt = Sha256::digest(salt_input);
    let hkdf = Hkdf::<Sha256>::new(Some(&salt), mnemonic_entropy);
    let mut master = [0_u8; 32];
    hkdf.expand(RECOVERY_INFO, &mut master)
        .map_err(|_| "secure content recovery derivation failed".to_string())?;
    Ok(RecoveryMaster(master))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_master_has_a_fixed_domain_separated_vector() {
        let master =
            derive_recovery_master(&[0x0b; 32], "ptid:v1:actor:peers:p:alice:key", 7).unwrap();
        assert_eq!(
            hex(master.as_bytes()),
            "23c5225a6420e8a86b1cc971df425fa9285afd4a17bb145a68fa538e0a11ced5"
        );
    }

    #[test]
    fn recovery_master_rejects_incomplete_or_epochless_input() {
        assert!(derive_recovery_master(&[0; 15], "actor", 1).is_err());
        assert!(derive_recovery_master(&[0; 16], "", 1).is_err());
        assert!(derive_recovery_master(&[0; 16], "actor", 0).is_err());
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
