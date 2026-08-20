pub use messaging_core::codec::verification::{delivery_commitment, verify_device_event_delivery};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::chat::{
        conversation_event, ConversationEvent, CryptoEndpoint, DeviceEventDelivery,
        DeviceQueueItem, MessageCommittedFact, PreparedEndpointPayloadKind,
    };
    use prost::Message;
    use sha2::{Digest, Sha256};

    fn queue_item() -> DeviceQueueItem {
        let recipient = CryptoEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };
        let endpoint_payload = b"direct ciphertext".to_vec();
        let endpoint_payload_sha256 = Sha256::digest(&endpoint_payload).to_vec();
        let mut event = ConversationEvent {
            event_id: "event-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            sequence: 1,
            command_id: "command-1".to_string(),
            actor: Some(CryptoEndpoint {
                ptid: "ptid:bob".to_string(),
                device_id: "bob-device".to_string(),
            }),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: None,
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 0,
            authority_station_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MessageCommitted(
                MessageCommittedFact::default(),
            )),
        };
        let commitment = delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &recipient.ptid,
            &recipient.device_id,
            PreparedEndpointPayloadKind::DirectCiphertext,
            &endpoint_payload_sha256,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(recipient.clone()),
            payload_kind: PreparedEndpointPayloadKind::DirectCiphertext as i32,
            endpoint_payload,
            endpoint_payload_sha256,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![1; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        DeviceQueueItem {
            item_id: "item-1".to_string(),
            recipient: Some(recipient),
            lane_sequence: 1,
            event_id: "event-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            idempotency_key: "event:event-1".to_string(),
            payload_type: 1,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            state: 1,
            attempt_count: 0,
            lease: None,
            first_queued_at: None,
            next_attempt_at: None,
            expires_at: None,
            consumed_at: None,
            acked_at: None,
            last_error_code: String::new(),
        }
    }

    #[test]
    fn valid_delivery_verifies() {
        let item = queue_item();
        verify_device_event_delivery(&item, "ptid:alice", "alice-device").unwrap();
    }

    #[test]
    fn endpoint_payload_and_queue_tampering_fail_closed() {
        let mut item = queue_item();
        assert!(verify_device_event_delivery(&item, "ptid:mallory", "alice-device").is_err());

        item.opaque_payload.push(1);
        assert!(verify_device_event_delivery(&item, "ptid:alice", "alice-device").is_err());
    }
}
