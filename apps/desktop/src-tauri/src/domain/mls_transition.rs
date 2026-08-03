use crate::model::chat::{
    committed_conversation_event, CommittedConversationEvent, MembershipTransitionCommittedEvent,
    MlsTransitionDeliveryKind, MlsTransitionDeliveryPayload,
};
use prost::Message;
use sha2::{Digest, Sha256};

pub const RECIPIENT_REORDER_LIMIT: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecipientTransitionHead {
    pub group_seq: i64,
    pub event_hash: Vec<u8>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub transition_id: String,
    pub commit_sha256: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventOrder {
    Duplicate,
    Next,
    Gap,
}

#[derive(Clone, Debug)]
pub struct ValidatedAuthorityEvent {
    pub event: CommittedConversationEvent,
    pub transition: Option<MembershipTransitionCommittedEvent>,
}

#[derive(Clone, Debug)]
pub struct ValidatedMlsDelivery {
    pub delivery: MlsTransitionDeliveryPayload,
    pub kind: MlsTransitionDeliveryKind,
}

pub fn decode_authority_event(bytes: &[u8]) -> Result<ValidatedAuthorityEvent, String> {
    let event = CommittedConversationEvent::decode(bytes)
        .map_err(|e| format!("decode authority event: {e}"))?;
    validate_authority_event(event)
}

pub fn validate_authority_event(
    event: CommittedConversationEvent,
) -> Result<ValidatedAuthorityEvent, String> {
    if event.conversation_id.trim().is_empty() || event.group_seq <= 0 {
        return Err("authority event requires conversation_id and positive group_seq".to_string());
    }
    if event.event_hash.len() != 32 {
        return Err("authority event hash must be 32 bytes".to_string());
    }
    let mut hash_input = event.clone();
    hash_input.event_hash.clear();
    let actual_hash = Sha256::digest(hash_input.encode_to_vec());
    if actual_hash.as_slice() != event.event_hash.as_slice() {
        return Err("authority event hash mismatch".to_string());
    }

    let transition = match event.payload.as_ref() {
        Some(committed_conversation_event::Payload::MembershipTransitionCommitted(value)) => {
            validate_transition_event(&event, value)?;
            Some(value.clone())
        }
        _ => None,
    };
    Ok(ValidatedAuthorityEvent { event, transition })
}

pub fn decode_mls_delivery(bytes: &[u8]) -> Result<ValidatedMlsDelivery, String> {
    let delivery = MlsTransitionDeliveryPayload::decode(bytes)
        .map_err(|e| format!("decode MLS transition delivery: {e}"))?;
    validate_mls_delivery(delivery)
}

pub fn validate_mls_delivery(
    delivery: MlsTransitionDeliveryPayload,
) -> Result<ValidatedMlsDelivery, String> {
    if delivery.conversation_id.trim().is_empty()
        || delivery.transition_id.trim().is_empty()
        || delivery.group_seq <= 0
    {
        return Err(
            "MLS transition delivery requires conversation_id, transition_id, and group_seq"
                .to_string(),
        );
    }
    if delivery.to_membership_epoch != delivery.from_membership_epoch + 1
        || delivery.to_mls_epoch != delivery.from_mls_epoch + 1
    {
        return Err("MLS transition delivery has impossible epoch progression".to_string());
    }
    if delivery.payload_sha256.len() != 32 {
        return Err("MLS transition delivery hash must be 32 bytes".to_string());
    }
    let actual_hash = Sha256::digest(&delivery.opaque_mls_bytes);
    if actual_hash.as_slice() != delivery.payload_sha256.as_slice() {
        return Err("MLS transition delivery payload hash mismatch".to_string());
    }
    let kind = MlsTransitionDeliveryKind::try_from(delivery.kind)
        .map_err(|_| "unknown MLS transition delivery kind".to_string())?;
    if kind == MlsTransitionDeliveryKind::Unspecified {
        return Err("MLS transition delivery kind is unspecified".to_string());
    }
    Ok(ValidatedMlsDelivery { delivery, kind })
}

pub fn validate_event_delivery_pair(
    authority: &ValidatedAuthorityEvent,
    material: &ValidatedMlsDelivery,
    recipient_ptid: &str,
    recipient_device_id: &str,
) -> Result<(), String> {
    let transition = authority
        .transition
        .as_ref()
        .ok_or_else(|| "authority event is not a membership transition".to_string())?;
    let delivery = &material.delivery;
    if authority.event.conversation_id != delivery.conversation_id
        || authority.event.group_seq != delivery.group_seq
        || transition.transition_id != delivery.transition_id
        || transition.from_membership_epoch != delivery.from_membership_epoch
        || transition.to_membership_epoch != delivery.to_membership_epoch
        || transition.from_mls_epoch != delivery.from_mls_epoch
        || transition.to_mls_epoch != delivery.to_mls_epoch
    {
        return Err("authority event and MLS delivery bindings differ".to_string());
    }

    match material.kind {
        MlsTransitionDeliveryKind::Commit => {
            if transition.opaque_mls_commit_bytes != delivery.opaque_mls_bytes
                || transition.commit_sha256 != delivery.payload_sha256
            {
                return Err("MLS Commit differs from authority evidence".to_string());
            }
        }
        MlsTransitionDeliveryKind::Welcome => {
            let descriptor = transition.welcome_descriptors.iter().find(|descriptor| {
                descriptor.recipient_ptid == recipient_ptid
                    && descriptor.recipient_device_id == recipient_device_id
            });
            let descriptor = descriptor
                .ok_or_else(|| "MLS Welcome is not addressed to this device".to_string())?;
            if descriptor.welcome_sha256 != delivery.payload_sha256 {
                return Err("MLS Welcome differs from authority evidence".to_string());
            }
        }
        MlsTransitionDeliveryKind::Unspecified => {
            return Err("MLS transition delivery kind is unspecified".to_string())
        }
    }
    Ok(())
}

pub fn classify_event_order(
    head: Option<&RecipientTransitionHead>,
    event: &CommittedConversationEvent,
) -> Result<EventOrder, String> {
    let Some(head) = head else {
        return Ok(if event.group_seq == 1 {
            EventOrder::Next
        } else {
            EventOrder::Gap
        });
    };
    if event.group_seq == head.group_seq {
        return if event.event_hash == head.event_hash {
            Ok(EventOrder::Duplicate)
        } else {
            Err("authority reused group_seq with a different event hash".to_string())
        };
    }
    if event.group_seq < head.group_seq {
        return Err("authority event is older than the durable recipient head".to_string());
    }
    if event.group_seq > head.group_seq + 1 {
        return Ok(EventOrder::Gap);
    }
    if event.prev_event_hash != head.event_hash {
        return Err("authority event does not extend the durable recipient head".to_string());
    }
    Ok(EventOrder::Next)
}

pub fn can_bootstrap_from_welcome(
    head: Option<&RecipientTransitionHead>,
    authority: &ValidatedAuthorityEvent,
    material: &ValidatedMlsDelivery,
) -> bool {
    head.is_none()
        && authority.transition.is_some()
        && material.kind == MlsTransitionDeliveryKind::Welcome
        && material.delivery.from_membership_epoch > 0
        && material.delivery.from_mls_epoch > 0
}

fn validate_transition_event(
    event: &CommittedConversationEvent,
    transition: &MembershipTransitionCommittedEvent,
) -> Result<(), String> {
    if transition.transition_id.trim().is_empty() {
        return Err("membership transition event requires transition_id".to_string());
    }
    if transition.to_membership_epoch != transition.from_membership_epoch + 1
        || transition.to_mls_epoch != transition.from_mls_epoch + 1
        || event.membership_epoch != transition.to_membership_epoch
    {
        return Err("membership transition event has impossible epoch progression".to_string());
    }
    if transition.commit_sha256.len() != 32 {
        return Err("membership transition Commit hash must be 32 bytes".to_string());
    }
    let commit_hash = Sha256::digest(&transition.opaque_mls_commit_bytes);
    if commit_hash.as_slice() != transition.commit_sha256.as_slice() {
        return Err("membership transition Commit hash mismatch".to_string());
    }
    for descriptor in &transition.welcome_descriptors {
        if descriptor.recipient_ptid.trim().is_empty()
            || descriptor.recipient_device_id.trim().is_empty()
            || descriptor.welcome_sha256.len() != 32
        {
            return Err("membership transition has an invalid Welcome descriptor".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::chat::{MembershipTransitionCommittedEvent, MlsWelcomeDescriptor};

    fn transition_event(seq: i64, prev_hash: Vec<u8>) -> CommittedConversationEvent {
        let commit = b"commit".to_vec();
        let commit_hash = Sha256::digest(&commit).to_vec();
        let mut event = CommittedConversationEvent {
            event_id: format!("event-{seq}"),
            conversation_id: "conversation-1".to_string(),
            group_seq: seq,
            membership_epoch: 1,
            committed_by_station_peer_id: "station-1".to_string(),
            committed_at: None,
            event_hash: Vec::new(),
            prev_event_hash: prev_hash,
            payload: Some(
                committed_conversation_event::Payload::MembershipTransitionCommitted(
                    MembershipTransitionCommittedEvent {
                        transition_id: "transition-1".to_string(),
                        from_membership_epoch: 0,
                        to_membership_epoch: 1,
                        from_mls_epoch: 0,
                        to_mls_epoch: 1,
                        changes: Vec::new(),
                        opaque_mls_commit_bytes: commit,
                        commit_sha256: commit_hash,
                        leave_intent_id: String::new(),
                        welcome_descriptors: vec![MlsWelcomeDescriptor {
                            recipient_ptid: "bob".to_string(),
                            recipient_device_id: "bob-device".to_string(),
                            recipient_home_station_peer_id: "station-1".to_string(),
                            welcome_sha256: Sha256::digest(b"welcome").to_vec(),
                        }],
                    },
                ),
            ),
        };
        let mut hash_input = event.clone();
        hash_input.event_hash.clear();
        event.event_hash = Sha256::digest(hash_input.encode_to_vec()).to_vec();
        event
    }

    fn welcome_delivery(seq: i64) -> MlsTransitionDeliveryPayload {
        MlsTransitionDeliveryPayload {
            conversation_id: "conversation-1".to_string(),
            transition_id: "transition-1".to_string(),
            group_seq: seq,
            from_membership_epoch: 0,
            to_membership_epoch: 1,
            from_mls_epoch: 0,
            to_mls_epoch: 1,
            kind: MlsTransitionDeliveryKind::Welcome as i32,
            opaque_mls_bytes: b"welcome".to_vec(),
            payload_sha256: Sha256::digest(b"welcome").to_vec(),
        }
    }

    #[test]
    fn validates_exact_genesis_welcome_pair_without_skipping_created_event() {
        let authority = validate_authority_event(transition_event(7, vec![9; 32])).unwrap();
        let material = validate_mls_delivery(welcome_delivery(7)).unwrap();
        validate_event_delivery_pair(&authority, &material, "bob", "bob-device").unwrap();
        assert!(!can_bootstrap_from_welcome(None, &authority, &material));
    }

    #[test]
    fn later_member_can_bootstrap_from_addressed_welcome() {
        let mut event = transition_event(7, vec![9; 32]);
        event.membership_epoch = 3;
        if let Some(committed_conversation_event::Payload::MembershipTransitionCommitted(
            transition,
        )) = event.payload.as_mut()
        {
            transition.from_membership_epoch = 2;
            transition.to_membership_epoch = 3;
            transition.from_mls_epoch = 2;
            transition.to_mls_epoch = 3;
        }
        event.event_hash.clear();
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let authority = validate_authority_event(event).unwrap();
        let mut delivery = welcome_delivery(7);
        delivery.from_membership_epoch = 2;
        delivery.to_membership_epoch = 3;
        delivery.from_mls_epoch = 2;
        delivery.to_mls_epoch = 3;
        let material = validate_mls_delivery(delivery).unwrap();
        assert!(can_bootstrap_from_welcome(None, &authority, &material));
    }

    #[test]
    fn rejects_mismatched_welcome_hash() {
        let authority = validate_authority_event(transition_event(7, vec![9; 32])).unwrap();
        let mut delivery = welcome_delivery(7);
        delivery.opaque_mls_bytes = b"forged".to_vec();
        delivery.payload_sha256 = Sha256::digest(b"forged").to_vec();
        let material = validate_mls_delivery(delivery).unwrap();
        assert!(validate_event_delivery_pair(&authority, &material, "bob", "bob-device").is_err());
    }

    #[test]
    fn classifies_duplicate_gap_and_fork() {
        let first = transition_event(1, Vec::new());
        let first_hash = first.event_hash.clone();
        let head = RecipientTransitionHead {
            group_seq: 1,
            event_hash: first_hash.clone(),
            membership_epoch: 1,
            mls_epoch: 1,
            transition_id: "transition-1".to_string(),
            commit_sha256: vec![1; 32],
        };
        assert_eq!(
            classify_event_order(Some(&head), &first).unwrap(),
            EventOrder::Duplicate
        );

        let future = transition_event(3, first_hash.clone());
        assert_eq!(
            classify_event_order(Some(&head), &future).unwrap(),
            EventOrder::Gap
        );

        let mut fork = first;
        fork.event_hash = vec![2; 32];
        assert!(classify_event_order(Some(&head), &fork).is_err());
    }
}
