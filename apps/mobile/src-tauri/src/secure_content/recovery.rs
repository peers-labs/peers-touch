use bip39::{Language, Mnemonic};
use prost::Message;
use secure_content_core::envelope::{open_content_key, ContentKey, SealedContentKey};
use secure_content_core::prekey::{ContentPreKeyPair, ContentPreKeyPublic};
use secure_content_core::recovery::{
    derive_recovery_master, derive_recovery_prekey, derive_validated_recovery_prekey,
    RecoveryMaster, RECOVERY_ENTROPY_SIZE,
};
use zeroize::{Zeroize, Zeroizing};

use crate::secure_content::proto::secure_content::v1 as wire;
use crate::secure_content::store::PrivateSocialStore;

pub const INITIAL_SECURE_CONTENT_RECOVERY_EPOCH: u64 = 1;

pub fn store_recovery_phrase(
    store: &PrivateSocialStore,
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
    store: &PrivateSocialStore,
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

pub fn open_recovery_content_key(
    store: &PrivateSocialStore,
    actor_ptid: &str,
    envelope: &wire::ViewerContentKeyEnvelope,
) -> Result<ContentKey, String> {
    let binding = envelope
        .binding
        .as_ref()
        .ok_or_else(|| "secure content recovery envelope binding is unavailable".to_string())?;
    let recovery_actor = match envelope.recipient.as_ref() {
        Some(wire::viewer_content_key_envelope::Recipient::RecoveryActor(actor)) => actor,
        _ => {
            return Err(
                "secure content recovery envelope does not target an actor recovery key"
                    .to_string(),
            )
        }
    };
    if recovery_actor.ptid != actor_ptid
        || binding.recipient_key_kind
            != wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32
        || envelope.principal_epoch == 0
        || binding.recipient_key_id.trim().is_empty()
    {
        return Err("secure content recovery envelope identity is invalid".to_string());
    }
    let master_bytes = store
        .recovery_master(actor_ptid, envelope.principal_epoch)?
        .ok_or_else(|| {
            format!(
                "secure content recovery master is unavailable for epoch {}",
                envelope.principal_epoch
            )
        })?;
    let master = RecoveryMaster::from_bytes(master_bytes);
    let expected = derive_recovery_prekey(
        &master,
        actor_ptid,
        envelope.principal_epoch,
        &binding.recipient_key_id,
    )?;
    let pair = recovery_prekey(
        store,
        actor_ptid,
        envelope.principal_epoch,
        &binding.recipient_key_id,
        expected.public(),
    )?;
    open_content_key(
        pair.private(),
        &binding.encode_to_vec(),
        &SealedContentKey {
            encapsulated_key: envelope.hpke_encapsulated_key.clone(),
            ciphertext: envelope.hpke_ciphertext.clone(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon abandon art";

    #[test]
    fn recovery_master_is_bound_to_actor_epoch_and_key() {
        let store = PrivateSocialStore::in_memory("station-a", "ptid:alice").unwrap();
        store_recovery_phrase(&store, "ptid:alice", 7, PHRASE).unwrap();
        let master =
            RecoveryMaster::from_bytes(store.recovery_master("ptid:alice", 7).unwrap().unwrap());
        let expected = derive_recovery_prekey(&master, "ptid:alice", 7, "key-1").unwrap();

        assert!(recovery_prekey(&store, "ptid:alice", 7, "key-1", expected.public(),).is_ok());
        assert!(recovery_prekey(&store, "ptid:alice", 8, "key-1", expected.public(),).is_err());
    }
}
