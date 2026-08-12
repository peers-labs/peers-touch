use crate::proto::chat::{
    ConversationEvent, DeviceEventDelivery, DeviceQueueItem, PreparedEndpointPayloadKind,
};
use prost::Message;
use sha2::{Digest, Sha256};

const DELIVERY_COMMITMENT_DOMAIN: &[u8] = b"peers-touch/device-delivery-commitment";

pub fn verify_device_event_delivery(
    item: &DeviceQueueItem,
    local_ptid: &str,
    local_device_id: &str,
) -> Result<DeviceEventDelivery, String> {
    let recipient = item
        .recipient
        .as_ref()
        .ok_or_else(|| "messaging queue item has no recipient".to_string())?;
    if recipient.ptid != local_ptid || recipient.device_id != local_device_id {
        return Err("messaging queue item targets another endpoint".to_string());
    }
    if item.payload_sha256.len() != 32
        || Sha256::digest(&item.opaque_payload).as_slice() != item.payload_sha256
    {
        return Err("messaging queue payload hash mismatch".to_string());
    }
    let delivery = DeviceEventDelivery::decode(item.opaque_payload.as_slice())
        .map_err(|error| format!("messaging delivery decode failed: {error}"))?;
    let delivery_recipient = delivery
        .recipient
        .as_ref()
        .ok_or_else(|| "messaging delivery has no recipient".to_string())?;
    if delivery_recipient != recipient {
        return Err("messaging delivery recipient binding mismatch".to_string());
    }
    let event = delivery
        .event
        .as_ref()
        .ok_or_else(|| "messaging delivery has no authority event".to_string())?;
    if event.event_id != item.event_id
        || event.conversation_id != item.conversation_id
        || event.authority_station_id.trim().is_empty()
    {
        return Err("messaging delivery event binding mismatch".to_string());
    }
    if event.event_hash.len() != 32
        || (!event.previous_hash.is_empty() && event.previous_hash.len() != 32)
    {
        return Err("messaging authority hash shape is invalid".to_string());
    }
    let mut hash_input = event.clone();
    hash_input.event_hash.clear();
    if Sha256::digest(hash_input.encode_to_vec()).as_slice() != event.event_hash {
        return Err("messaging authority event hash mismatch".to_string());
    }
    if delivery.endpoint_payload_sha256.len() != 32
        || Sha256::digest(&delivery.endpoint_payload).as_slice() != delivery.endpoint_payload_sha256
    {
        return Err("messaging endpoint payload hash mismatch".to_string());
    }
    if delivery.delivery_commitment.len() != 32 {
        return Err("messaging delivery commitment shape is invalid".to_string());
    }
    let payload_kind = PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
        .map_err(|_| "messaging delivery payload kind is invalid".to_string())?;
    let commitment = delivery_commitment(
        &event.conversation_id,
        &event.event_id,
        &recipient.ptid,
        &recipient.device_id,
        payload_kind,
        &delivery.endpoint_payload_sha256,
    );
    if commitment.as_slice() != delivery.delivery_commitment {
        return Err("messaging delivery commitment mismatch".to_string());
    }
    if !event
        .delivery_commitments
        .windows(2)
        .all(|window| window[0] < window[1])
        || !event
            .delivery_commitments
            .iter()
            .all(|value| value.len() == 32)
        || event
            .delivery_commitments
            .binary_search(&commitment.to_vec())
            .is_err()
    {
        return Err("messaging authority delivery set is invalid".to_string());
    }
    Ok(delivery)
}

pub fn delivery_commitment(
    conversation_id: &str,
    event_id: &str,
    recipient_ptid: &str,
    recipient_device_id: &str,
    payload_kind: PreparedEndpointPayloadKind,
    payload_sha256: &[u8],
) -> [u8; 32] {
    let mut input = Vec::new();
    input.extend_from_slice(DELIVERY_COMMITMENT_DOMAIN);
    input.push(0);
    input.extend_from_slice(&1_u32.to_be_bytes());
    write_string(&mut input, conversation_id);
    write_string(&mut input, event_id);
    write_string(&mut input, recipient_ptid);
    write_string(&mut input, recipient_device_id);
    input.extend_from_slice(&(payload_kind as u32).to_be_bytes());
    input.extend_from_slice(payload_sha256);
    Sha256::digest(input).into()
}

fn write_string(target: &mut Vec<u8>, value: &str) {
    target.extend_from_slice(&(value.len() as u32).to_be_bytes());
    target.extend_from_slice(value.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::chat::{conversation_event, CryptoEndpoint, MessageCommittedFact};

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
