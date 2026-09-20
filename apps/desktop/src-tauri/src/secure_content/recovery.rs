use bip39::{Language, Mnemonic};
use secure_content_core::prekey::{ContentPreKeyPair, ContentPreKeyPublic};
use secure_content_core::recovery::{
    derive_recovery_master, derive_validated_recovery_prekey, RecoveryMaster, RECOVERY_ENTROPY_SIZE,
};
use zeroize::{Zeroize, Zeroizing};

use super::store::SecureContentStore;

pub const INITIAL_SECURE_CONTENT_RECOVERY_EPOCH: u64 = 1;

pub fn store_recovery_phrase(
    store: &SecureContentStore,
    actor_ptid: &str,
    recovery_epoch: u64,
    phrase: &str,
) -> Result<(), String> {
    let words = phrase.split_whitespace().count();
    if words != 24 {
        return Err(format!(
            "secure content recovery phrase must contain 24 words, got {words}"
        ));
    }
    let mnemonic = Mnemonic::parse_in(Language::English, phrase)
        .map_err(|_| "secure content recovery phrase is invalid".to_string())?;
    let mut entropy = Zeroizing::new(mnemonic.to_entropy());
    if entropy.len() != RECOVERY_ENTROPY_SIZE {
        return Err("secure content recovery phrase must contain 256 bits of entropy".to_string());
    }
    let master = derive_recovery_master(entropy.as_slice(), actor_ptid, recovery_epoch)?;
    entropy.zeroize();
    store.store_recovery_master(actor_ptid, recovery_epoch, master.as_bytes())
}

pub fn recovery_prekey(
    store: &SecureContentStore,
    actor_ptid: &str,
    recovery_epoch: u64,
    key_id: &str,
    claimed_public: ContentPreKeyPublic,
) -> Result<ContentPreKeyPair, String> {
    let bytes = store
        .recovery_master(actor_ptid, recovery_epoch)?
        .ok_or_else(|| {
            format!("secure content recovery master is unavailable for epoch {recovery_epoch}")
        })?;
    let master = RecoveryMaster::from_bytes(bytes);
    derive_validated_recovery_prekey(&master, actor_ptid, recovery_epoch, key_id, claimed_public)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon abandon art";

    #[test]
    fn secure_content_recovery_rehydrates_only_the_exact_epoch_master() {
        let store = SecureContentStore::in_memory().unwrap();
        store_recovery_phrase(&store, "ptid:alice", 7, PHRASE).unwrap();
        let master_bytes = store.recovery_master("ptid:alice", 7).unwrap().unwrap();
        let master = RecoveryMaster::from_bytes(master_bytes);
        let expected = secure_content_core::recovery::derive_recovery_prekey(
            &master,
            "ptid:alice",
            7,
            "recovery-key-1",
        )
        .unwrap();

        assert!(
            recovery_prekey(&store, "ptid:alice", 7, "recovery-key-1", expected.public(),).is_ok()
        );
        assert!(
            recovery_prekey(&store, "ptid:alice", 8, "recovery-key-1", expected.public(),).is_err()
        );
    }
}
