use bip39::{Language, Mnemonic};
use prost::Message;
use secure_content_core::envelope::ContentKey;
use secure_content_core::operation::{continue_recovery_envelope, RecoveryEnvelopeContinuation};
use secure_content_core::recovery::{derive_recovery_master, RECOVERY_ENTROPY_SIZE};
use zeroize::{Zeroize, Zeroizing};

use crate::model::secure_content as wire;

use super::store::SecureContentStore;
use super::SecureContentLease;

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

pub fn open_recovery_content_key(
    lease: &SecureContentLease,
    envelope: &wire::ViewerContentKeyEnvelope,
) -> Result<ContentKey, String> {
    let actor_ptid = &lease.session.key.actor_ptid;
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
    if recovery_actor.ptid != actor_ptid.as_str()
        || binding.recipient_key_kind
            != wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32
        || envelope.principal_epoch == 0
        || binding.recipient_key_id.trim().is_empty()
    {
        return Err("secure content recovery envelope identity is invalid".to_string());
    }
    continue_recovery_envelope(
        lease,
        lease.session.as_ref(),
        &RecoveryEnvelopeContinuation {
            actor_ptid: actor_ptid.clone(),
            recovery_epoch: envelope.principal_epoch,
            key_id: binding.recipient_key_id.clone(),
            binding: binding.encode_to_vec(),
            encapsulated_key: envelope.hpke_encapsulated_key.clone(),
            ciphertext: envelope.hpke_ciphertext.clone(),
        },
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon abandon art";

    #[test]
    fn secure_content_recovery_phrase_stores_only_the_exact_epoch_master() {
        let store = SecureContentStore::in_memory().unwrap();
        store_recovery_phrase(&store, "ptid:alice", 7, PHRASE).unwrap();
        let master_bytes = store.recovery_master("ptid:alice", 7).unwrap().unwrap();
        assert_eq!(master_bytes.len(), 32);
        assert!(store.recovery_master("ptid:alice", 8).unwrap().is_none());
    }
}
