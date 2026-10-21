use bip39::{Language, Mnemonic};
use prost::Message;
use secure_content_core::envelope::ContentKey;
use secure_content_core::operation::{
    continue_recovery_envelope, OperationErrorCode, OperationFailure, RecoveryEnvelopeContinuation,
};
use secure_content_core::ports::ContentKeyMaterial;
use secure_content_core::recovery::{
    derive_recovery_master, RecoveryMaster, RECOVERY_ENTROPY_SIZE,
};
use zeroize::{Zeroize, Zeroizing};

use crate::secure_content::proto::secure_content::v1 as wire;
use crate::secure_content::store::PrivateSocialStore;
use crate::secure_content::NativeSocialSession;

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

pub fn open_recovery_content_key(
    session: &NativeSocialSession,
    store: &PrivateSocialStore,
    envelope: &wire::ViewerContentKeyEnvelope,
) -> Result<ContentKey, String> {
    let actor_ptid = &session.scope.actor_ptid;
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
        &MobileContentKeyMaterial { session, store },
        store,
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

struct MobileContentKeyMaterial<'a> {
    session: &'a NativeSocialSession,
    store: &'a PrivateSocialStore,
}

impl ContentKeyMaterial for MobileContentKeyMaterial<'_> {
    fn recovery_master(
        &self,
        actor_ptid: &str,
        recovery_epoch: u64,
    ) -> Result<Option<RecoveryMaster>, OperationFailure> {
        self.store
            .recovery_master(actor_ptid, recovery_epoch)
            .map(|master| master.map(RecoveryMaster::from_bytes))
            .map_err(|detail| {
                OperationFailure::terminal(OperationErrorCode::StoreUnavailable, detail)
            })
    }

    fn sign_device_payload(&self, payload: &[u8]) -> Result<Vec<u8>, OperationFailure> {
        Ok(self.session.sign(payload))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon abandon art";

    #[test]
    fn recovery_phrase_stores_only_the_exact_actor_epoch_master() {
        let store = PrivateSocialStore::in_memory("station-a", "ptid:alice").unwrap();
        store_recovery_phrase(&store, "ptid:alice", 7, PHRASE).unwrap();
        assert!(store.recovery_master("ptid:alice", 7).unwrap().is_some());
        assert!(store.recovery_master("ptid:alice", 8).unwrap().is_none());
    }
}
