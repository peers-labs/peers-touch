use crate::proto::actor_device_ptid;
use crate::proto::chat::{
    conversation_event, ConversationCreatedFact, ConversationEvent, ConversationKind,
    DeviceEventDelivery, DurableDeviceInboxItem, PreparedEndpointPayloadKind,
};
use prost::Message;
use sha2::{Digest, Sha256};

const DELIVERY_COMMITMENT_DOMAIN: &[u8] = b"peers-touch/device-delivery-commitment";

pub fn verify_authority_event(event: &ConversationEvent) -> Result<(), String> {
    if event.event_id.trim().is_empty()
        || event.conversation_id.trim().is_empty()
        || event.sequence <= 0
        || event.authority_station_peer_id.trim().is_empty()
    {
        return Err("messaging authority event binding is incomplete".to_string());
    }
    if event.event_hash.len() != 32
        || (!event.previous_hash.is_empty() && event.previous_hash.len() != 32)
    {
        return Err("messaging authority hash shape is invalid".to_string());
    }
    if !event
        .delivery_commitments
        .windows(2)
        .all(|window| window[0] < window[1])
        || !event
            .delivery_commitments
            .iter()
            .all(|value| value.len() == 32)
    {
        return Err("messaging authority delivery set is invalid".to_string());
    }
    let mut hash_input = event.clone();
    hash_input.event_hash.clear();
    if Sha256::digest(hash_input.encode_to_vec()).as_slice() != event.event_hash {
        return Err("messaging authority event hash mismatch".to_string());
    }
    Ok(())
}

pub fn verify_direct_genesis_event<'a>(
    event: &'a ConversationEvent,
    local_ptid: &str,
) -> Result<&'a ConversationCreatedFact, String> {
    verify_authority_event(event)?;
    let actor = event
        .actor
        .as_ref()
        .ok_or_else(|| "messaging Direct genesis actor is missing".to_string())?;
    let created = match event.payload.as_ref() {
        Some(conversation_event::Payload::ConversationCreated(created)) => created,
        _ => return Err("messaging Direct genesis event is unsupported".to_string()),
    };
    let snapshot = created
        .post_state
        .as_ref()
        .ok_or_else(|| "messaging Direct genesis authority snapshot is missing".to_string())?;
    if local_ptid.trim().is_empty()
        || event.sequence != 1
        || !event.previous_hash.is_empty()
        || event.command_id.trim().is_empty()
        || event.committed_at.is_none()
        || event.membership_epoch != 1
        || event.mls_epoch != 0
        || created.kind != ConversationKind::Direct as i32
        || snapshot.kind != created.kind
        || snapshot.name != created.name
        || snapshot.owner_ptid != created.owner_ptid
        || snapshot.active_members != created.members
        || snapshot.federation_id.trim().is_empty()
        || snapshot.authority_epoch <= 0
        || snapshot.membership_epoch != event.membership_epoch
        || snapshot.mls_epoch != event.mls_epoch
        || snapshot.active_members.len() != 2
        || snapshot.active_endpoints.len() < 2
        || snapshot.active_endpoint_routes.len() != snapshot.active_endpoints.len()
        || event.delivery_commitments.len() != snapshot.active_endpoints.len()
    {
        return Err("messaging Direct genesis binding is invalid".to_string());
    }
    if snapshot.active_members[0].ptid != snapshot.owner_ptid
        || !snapshot
            .active_members
            .windows(2)
            .all(|members| members[0].ptid.as_str() < members[1].ptid.as_str())
        || snapshot.active_members.iter().any(|member| {
            member.ptid.trim().is_empty()
                || member.role != "member"
                || member.home_station_peer_id.trim().is_empty()
        })
        || !snapshot
            .active_members
            .iter()
            .any(|member| member.ptid == local_ptid)
    {
        return Err("messaging Direct genesis members are invalid".to_string());
    }
    if actor.ptid.trim().is_empty()
        || actor.device_id.trim().is_empty()
        || !snapshot
            .active_endpoints
            .iter()
            .any(|endpoint| endpoint == actor)
        || !snapshot.active_endpoints.windows(2).all(|endpoints| {
            (endpoints[0].ptid.as_str(), endpoints[0].device_id.as_str())
                < (endpoints[1].ptid.as_str(), endpoints[1].device_id.as_str())
        })
        || snapshot.active_endpoints.iter().any(|endpoint| {
            endpoint.ptid.trim().is_empty()
                || endpoint.device_id.trim().is_empty()
                || !snapshot
                    .active_members
                    .iter()
                    .any(|member| member.ptid == endpoint.ptid)
        })
    {
        return Err("messaging Direct genesis endpoints are invalid".to_string());
    }
    for endpoint in &snapshot.active_endpoints {
        let matching_routes = snapshot
            .active_endpoint_routes
            .iter()
            .filter(|route| {
                route.endpoint.as_ref().is_some_and(|candidate| {
                    candidate.ptid == endpoint.ptid && candidate.device_id == endpoint.device_id
                })
            })
            .collect::<Vec<_>>();
        if matching_routes.len() != 1 {
            return Err("messaging Direct genesis endpoint routes are invalid".to_string());
        }
        let route = matching_routes[0];
        let expected_home_station = snapshot
            .active_members
            .iter()
            .find(|member| member.ptid == endpoint.ptid)
            .map(|member| member.home_station_peer_id.as_str())
            .ok_or_else(|| "messaging Direct genesis endpoint member is missing".to_string())?;
        if route.home_station_peer_id != expected_home_station {
            return Err("messaging Direct genesis endpoint routes are invalid".to_string());
        }
    }
    Ok(created)
}

pub fn verify_device_event_delivery(
    item: &DurableDeviceInboxItem,
    local_ptid: &str,
    local_device_id: &str,
) -> Result<DeviceEventDelivery, String> {
    let recipient = item
        .recipient
        .as_ref()
        .ok_or_else(|| "messaging queue item has no recipient".to_string())?;
    let recipient_ptid = actor_device_ptid(recipient)?;
    if recipient_ptid != local_ptid || recipient.device_id != local_device_id {
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
    if delivery_recipient.ptid != recipient_ptid
        || delivery_recipient.device_id != recipient.device_id
    {
        return Err("messaging delivery recipient binding mismatch".to_string());
    }
    let event = delivery
        .event
        .as_ref()
        .ok_or_else(|| "messaging delivery has no authority event".to_string())?;
    if event.event_id != item.event_id || event.conversation_id != item.conversation_id {
        return Err("messaging delivery event binding mismatch".to_string());
    }
    verify_authority_event(event)?;
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
        recipient_ptid,
        &recipient.device_id,
        payload_kind,
        &delivery.endpoint_payload_sha256,
    );
    if commitment.as_slice() != delivery.delivery_commitment {
        return Err("messaging delivery commitment mismatch".to_string());
    }
    if event
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
    use crate::proto::actor_device_from_chat_endpoint;
    use crate::proto::chat::{
        conversation_event, ConversationAuthorityEndpoint, ConversationAuthorityMember,
        ConversationAuthoritySnapshot, ConversationCreatedFact, ConversationEvent, CryptoEndpoint,
        MessageCommittedFact,
    };

    fn queue_item() -> DurableDeviceInboxItem {
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
            authority_station_peer_id: "station-local".to_string(),
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
        DurableDeviceInboxItem {
            item_id: "item-1".to_string(),
            recipient: Some(actor_device_from_chat_endpoint(&recipient)),
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
            acked_at: None,
            last_error_code: 0,
        }
    }

    fn direct_genesis_event() -> ConversationEvent {
        let alice = CryptoEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };
        let bob = CryptoEndpoint {
            ptid: "ptid:bob".to_string(),
            device_id: "bob-device".to_string(),
        };
        let members = vec![
            ConversationAuthorityMember {
                ptid: alice.ptid.clone(),
                role: "member".to_string(),
                home_station_peer_id: "station-local".to_string(),
            },
            ConversationAuthorityMember {
                ptid: bob.ptid.clone(),
                role: "member".to_string(),
                home_station_peer_id: "station-local".to_string(),
            },
        ];
        let mut event = ConversationEvent {
            event_id: "created:direct-1".to_string(),
            conversation_id: "direct-1".to_string(),
            sequence: 1,
            command_id: "create:direct-1".to_string(),
            actor: Some(alice.clone()),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            delivery_commitments: vec![vec![1; 32], vec![2; 32]],
            membership_epoch: 1,
            mls_epoch: 0,
            authority_station_peer_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::ConversationCreated(
                ConversationCreatedFact {
                    kind: ConversationKind::Direct as i32,
                    name: String::new(),
                    owner_ptid: alice.ptid.clone(),
                    members: members.clone(),
                    post_state: Some(ConversationAuthoritySnapshot {
                        kind: ConversationKind::Direct as i32,
                        name: String::new(),
                        owner_ptid: alice.ptid.clone(),
                        active_members: members,
                        active_endpoints: vec![alice.clone(), bob.clone()],
                        membership_epoch: 1,
                        mls_epoch: 0,
                        active_endpoint_routes: vec![
                            ConversationAuthorityEndpoint {
                                endpoint: Some(bob),
                                home_station_peer_id: "station-local".to_string(),
                            },
                            ConversationAuthorityEndpoint {
                                endpoint: Some(alice),
                                home_station_peer_id: "station-local".to_string(),
                            },
                        ],
                        federation_id: "federation-1".to_string(),
                        authority_epoch: 1,
                        ..Default::default()
                    }),
                },
            )),
        };
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        event
    }

    #[test]
    fn valid_delivery_verifies() {
        let item = queue_item();
        verify_device_event_delivery(&item, "ptid:alice", "alice-device").unwrap();
    }

    #[test]
    fn authority_event_hash_verification_fails_closed() {
        let item = queue_item();
        let delivery = DeviceEventDelivery::decode(item.opaque_payload.as_slice()).unwrap();
        let event = delivery.event.unwrap();

        verify_authority_event(&event).unwrap();

        let mut tampered = event.clone();
        tampered.sequence += 1;
        assert_eq!(
            verify_authority_event(&tampered).unwrap_err(),
            "messaging authority event hash mismatch"
        );

        let mut malformed = event;
        malformed.delivery_commitments.push(vec![1; 31]);
        assert_eq!(
            verify_authority_event(&malformed).unwrap_err(),
            "messaging authority delivery set is invalid"
        );
    }

    #[test]
    fn direct_genesis_verification_binds_canonical_snapshot() {
        let event = direct_genesis_event();
        let created = verify_direct_genesis_event(&event, "ptid:bob").unwrap();
        assert_eq!(created.owner_ptid, "ptid:alice");

        let mut wrong_member = event.clone();
        let created = match wrong_member.payload.as_mut().unwrap() {
            conversation_event::Payload::ConversationCreated(created) => created,
            _ => unreachable!(),
        };
        created.members[1].role = "owner".to_string();
        created.post_state.as_mut().unwrap().active_members[1].role = "owner".to_string();
        wrong_member.event_hash.clear();
        wrong_member.event_hash = Sha256::digest(wrong_member.encode_to_vec()).to_vec();
        assert_eq!(
            verify_direct_genesis_event(&wrong_member, "ptid:bob").unwrap_err(),
            "messaging Direct genesis members are invalid"
        );

        assert_eq!(
            verify_direct_genesis_event(&event, "ptid:carol").unwrap_err(),
            "messaging Direct genesis members are invalid"
        );

        let mut wrong_route = event.clone();
        let created = match wrong_route.payload.as_mut().unwrap() {
            conversation_event::Payload::ConversationCreated(created) => created,
            _ => unreachable!(),
        };
        created.post_state.as_mut().unwrap().active_endpoint_routes[0].home_station_peer_id =
            "station-other".to_string();
        wrong_route.event_hash.clear();
        wrong_route.event_hash = Sha256::digest(wrong_route.encode_to_vec()).to_vec();
        assert_eq!(
            verify_direct_genesis_event(&wrong_route, "ptid:bob").unwrap_err(),
            "messaging Direct genesis endpoint routes are invalid"
        );
    }

    #[test]
    fn endpoint_payload_and_queue_tampering_fail_closed() {
        let mut item = queue_item();
        assert!(verify_device_event_delivery(&item, "ptid:mallory", "alice-device").is_err());

        item.opaque_payload.push(1);
        assert!(verify_device_event_delivery(&item, "ptid:alice", "alice-device").is_err());
    }
}
