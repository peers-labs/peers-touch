use super::{
    verify_device_event_delivery, ClaimedItemConsumer, EngineEndpoint, MessagingStore,
    PublicEventReceiveCommit,
};
use crate::model::chat::{
    conversation_event, CryptoEndpoint, DeviceConsumptionReceipt, DeviceQueueItem,
    DeviceQueuePayloadType, MessagingContentKind, PreparedEndpointPayloadKind, PublicEventMarker,
};
use prost::Message;
use std::sync::Arc;

pub struct PublicEventProcessor {
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
    clock: fn() -> i64,
}

impl PublicEventProcessor {
    pub fn new(
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging public-event processor requires complete endpoint".to_string());
        }
        Ok(Self {
            store,
            endpoint,
            clock,
        })
    }

    fn process(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        let now = (self.clock)();
        self.store.persist_claimed_item(
            &item.item_id,
            &item.event_id,
            &item.conversation_id,
            item.lane_sequence,
            consumer_epoch,
            &item.payload_sha256,
            &item.opaque_payload,
            now,
        )?;
        if self
            .store
            .consumption_marker_matches(&item.item_id, &item.payload_sha256)?
        {
            return Ok(());
        }
        if DeviceQueuePayloadType::try_from(item.payload_type)
            .map_err(|_| "messaging public-event queue payload type is invalid".to_string())?
            != DeviceQueuePayloadType::ConversationEvent
        {
            return Err(
                "messaging public-event processor received wrong queue payload type".to_string(),
            );
        }
        let delivery =
            verify_device_event_delivery(item, &self.endpoint.ptid, &self.endpoint.device_id)?;
        if PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging public-event payload kind is invalid".to_string())?
            != PreparedEndpointPayloadKind::PublicEvent
        {
            return Err("messaging public-event processor received non-marker payload".to_string());
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging public-event delivery has no event".to_string())?;
        let message = match event.payload.as_ref() {
            Some(conversation_event::Payload::MessageCommitted(message)) => message,
            _ => return Err("messaging public-event has no message fact".to_string()),
        };
        if MessagingContentKind::try_from(message.content_kind)
            .map_err(|_| "messaging public-event content kind is invalid".to_string())?
            != MessagingContentKind::Text
        {
            return Err("messaging public-event only accepts text projections".to_string());
        }
        let marker = PublicEventMarker::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging public-event marker is invalid".to_string())?;
        validate_marker_bindings(event, message, &marker, &self.endpoint)?;

        let committed_at_unix_ms = event
            .committed_at
            .as_ref()
            .map(|timestamp| {
                timestamp
                    .seconds
                    .saturating_mul(1_000)
                    .saturating_add(i64::from(timestamp.nanos) / 1_000_000)
            })
            .unwrap_or(now);
        let receipt = DeviceConsumptionReceipt {
            receipt_id: format!("device-consumed:{}", item.item_id),
            conversation_id: event.conversation_id.clone(),
            event_id: event.event_id.clone(),
            consumer: Some(CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            }),
            event_sequence: event.sequence,
            lane_sequence: item.lane_sequence,
            payload_sha256: item.payload_sha256.clone(),
            consumed_at: Some(prost_types::Timestamp {
                seconds: now.div_euclid(1_000),
                nanos: (now.rem_euclid(1_000) * 1_000_000) as i32,
            }),
        };
        let receipt_bytes = receipt.encode_to_vec();
        self.store.commit_public_event(&PublicEventReceiveCommit {
            item_id: &item.item_id,
            event_id: &event.event_id,
            conversation_id: &event.conversation_id,
            command_id: &event.command_id,
            message_id: &message.message_id,
            event_sequence: event.sequence,
            lane_sequence: item.lane_sequence,
            consumer_epoch,
            payload_sha256: &item.payload_sha256,
            event_hash: &event.event_hash,
            previous_event_hash: &event.previous_hash,
            sender_ptid: &self.endpoint.ptid,
            sender_device_id: &self.endpoint.device_id,
            committed_at_unix_ms,
            receipt_id: &receipt.receipt_id,
            receipt_bytes: &receipt_bytes,
            consumed_at_unix_ms: now,
        })?;
        Ok(())
    }
}

impl ClaimedItemConsumer for PublicEventProcessor {
    fn consume(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

fn validate_marker_bindings(
    event: &crate::model::chat::ConversationEvent,
    message: &crate::model::chat::MessageCommittedFact,
    marker: &PublicEventMarker,
    endpoint: &EngineEndpoint,
) -> Result<(), String> {
    let local = CryptoEndpoint {
        ptid: endpoint.ptid.clone(),
        device_id: endpoint.device_id.clone(),
    };
    if marker.conversation_id != event.conversation_id
        || marker.event_id != event.event_id
        || marker.command_id != event.command_id
        || marker.sending_endpoint.as_ref() != Some(&local)
        || event.actor.as_ref() != Some(&local)
        || message.sender.as_ref() != Some(&local)
        || message.message_id.trim().is_empty()
    {
        return Err("messaging public-event marker binding mismatch".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::verification::delivery_commitment;
    use super::*;
    use crate::domain::crypto::double_ratchet::DrSessionState;
    use crate::domain::crypto::{
        CryptoEndpoint as SessionEndpoint, DirectSession, DirectSessionKey,
    };
    use crate::messaging::{DirectSendCommit, PendingSenderProjection};
    use crate::model::chat::{
        ConversationEvent, DeviceEventDelivery, MessageCommittedFact, MessagingContentKind,
    };
    use sha2::{Digest, Sha256};

    fn now() -> i64 {
        1_000
    }

    fn direct_session() -> DirectSession {
        DirectSession {
            session_id: "session-1".to_string(),
            key: DirectSessionKey::new(
                "conversation-1",
                SessionEndpoint::new("ptid:alice", "alice-device").unwrap(),
                SessionEndpoint::new("ptid:bob", "bob-device").unwrap(),
                1,
            )
            .unwrap(),
            protocol_version: 1,
            established: true,
            peer_identity_key: [1; 32],
            ratchet: DrSessionState {
                session_id: "session-1".to_string(),
                root_key: [2; 32],
                self_priv: [3; 32],
                self_pub: [4; 32],
                peer_pub: Some([5; 32]),
                send_chain_key: Some([6; 32]),
                recv_chain_key: Some([7; 32]),
                n_send: 1,
                n_recv: 0,
                n_prev: 0,
            },
            updated_at_unix_ms: 900,
        }
    }

    fn queue_item() -> DeviceQueueItem {
        let endpoint = CryptoEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };
        let marker = PublicEventMarker {
            conversation_id: "conversation-1".to_string(),
            event_id: "event-1".to_string(),
            command_id: "command-1".to_string(),
            sending_endpoint: Some(endpoint.clone()),
        };
        let endpoint_payload = marker.encode_to_vec();
        let endpoint_payload_sha256 = Sha256::digest(&endpoint_payload).to_vec();
        let mut event = ConversationEvent {
            event_id: "event-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            sequence: 1,
            command_id: "command-1".to_string(),
            actor: Some(endpoint.clone()),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 0,
            authority_station_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MessageCommitted(
                MessageCommittedFact {
                    message_id: "message-1".to_string(),
                    sender: Some(endpoint.clone()),
                    content_kind: MessagingContentKind::Text as i32,
                    ..Default::default()
                },
            )),
        };
        let commitment = delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &endpoint.ptid,
            &endpoint.device_id,
            PreparedEndpointPayloadKind::PublicEvent,
            &endpoint_payload_sha256,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(endpoint.clone()),
            payload_kind: PreparedEndpointPayloadKind::PublicEvent as i32,
            endpoint_payload,
            endpoint_payload_sha256,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![1; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        DeviceQueueItem {
            item_id: "item-1".to_string(),
            recipient: Some(endpoint),
            lane_sequence: 1,
            event_id: "event-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            idempotency_key: "event:event-1".to_string(),
            payload_type: DeviceQueuePayloadType::ConversationEvent as i32,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }

    fn prepare_send(store: &MessagingStore) {
        store
            .persist_direct_send(&DirectSendCommit {
                command_bytes: b"exact command bytes",
                advanced_sessions: &[direct_session()],
                session_inits: &[],
                projection: PendingSenderProjection {
                    command_id: "command-1",
                    conversation_id: "conversation-1",
                    conversation_kind: 1,
                    message_id: "message-1",
                    sender_ptid: "ptid:alice",
                    sender_device_id: "alice-device",
                    plaintext: "exact sender plaintext",
                    delivery_plan_sha256: &[1; 32],
                    created_at_unix_ms: 900,
                },
            })
            .unwrap();
    }

    #[test]
    fn marker_atomically_promotes_sender_projection_and_replay_skips_pending_lookup() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        prepare_send(&store);
        let processor = PublicEventProcessor::new(
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            now,
        )
        .unwrap();
        let item = queue_item();
        processor.consume(&item, 3).unwrap();
        let (projection, state) = store
            .message_projection("conversation-1", "message-1")
            .unwrap()
            .unwrap();
        assert_eq!(projection.event_id, "event-1");
        assert_eq!(projection.plaintext, "exact sender plaintext");
        assert_eq!(state, "accepted");
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 3));
        assert!(store
            .consumption_marker_matches("item-1", &item.payload_sha256)
            .unwrap());
        assert!(store.next_command(1_000).unwrap().is_none());

        processor.consume(&item, 4).unwrap();
        assert_eq!(
            store
                .message_projection("conversation-1", "message-1")
                .unwrap()
                .unwrap()
                .0,
            projection
        );
    }

    #[test]
    fn marker_binding_failure_preserves_pending_projection_and_lane() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        prepare_send(&store);
        let processor = PublicEventProcessor::new(
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            now,
        )
        .unwrap();
        let mut item = queue_item();
        let mut delivery = DeviceEventDelivery::decode(item.opaque_payload.as_slice()).unwrap();
        let mut marker = PublicEventMarker::decode(delivery.endpoint_payload.as_slice()).unwrap();
        marker.command_id = "forged-command".to_string();
        delivery.endpoint_payload = marker.encode_to_vec();
        delivery.endpoint_payload_sha256 = Sha256::digest(&delivery.endpoint_payload).to_vec();
        let event = delivery.event.as_mut().unwrap();
        let recipient = delivery.recipient.as_ref().unwrap();
        let commitment = delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &recipient.ptid,
            &recipient.device_id,
            PreparedEndpointPayloadKind::PublicEvent,
            &delivery.endpoint_payload_sha256,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash.clear();
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        delivery.delivery_commitment = commitment.to_vec();
        item.opaque_payload = delivery.encode_to_vec();
        item.payload_sha256 = Sha256::digest(&item.opaque_payload).to_vec();

        assert!(processor.consume(&item, 3).is_err());
        assert!(store
            .message_projection("conversation-1", "message-1")
            .unwrap()
            .is_none());
        assert_eq!(store.lane_checkpoint().unwrap(), (0, 0));
        assert_eq!(
            store.next_command(1_000).unwrap().unwrap().command_id,
            "command-1"
        );
    }

    #[test]
    fn authority_marker_overrides_local_terminal_failure() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        prepare_send(&store);
        store
            .mark_command_failed(
                "command-1",
                b"exact command bytes",
                0,
                "ambiguous_terminal_response",
            )
            .unwrap();
        assert_eq!(
            store
                .pending_sender_projection("command-1")
                .unwrap()
                .unwrap(),
            ("exact sender plaintext".to_string(), "failed".to_string())
        );
        let processor = PublicEventProcessor::new(
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            now,
        )
        .unwrap();
        processor.consume(&queue_item(), 3).unwrap();
        let (projection, state) = store
            .message_projection("conversation-1", "message-1")
            .unwrap()
            .unwrap();
        assert_eq!(projection.plaintext, "exact sender plaintext");
        assert_eq!(state, "accepted");
        assert!(store
            .pending_sender_projection("command-1")
            .unwrap()
            .is_none());
    }
}
