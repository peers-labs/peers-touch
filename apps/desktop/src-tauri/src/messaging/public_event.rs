use super::store::{InteractionMutation, InteractionReceiveCommit};
use super::{
    verify_device_event_delivery, ClaimedItemConsumer, EngineEndpoint, MessagingStore,
    PublicEventReceiveCommit, ReceiveCommitResult,
};
use crate::model::chat::{
    conversation_event, CryptoEndpoint, DeviceConsumptionReceipt, DeviceInboxPayloadType,
    DurableDeviceInboxItem, MessageEditedFact, MessageHiddenForActorFact, MessagePinCommittedFact,
    MessageRetractedFact, MessagingContentKind, PreparedEndpointPayloadKind, PublicEventMarker,
    ReactionCommittedFact,
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

    fn process(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
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
        if DeviceInboxPayloadType::try_from(item.payload_type)
            .map_err(|_| "messaging public-event queue payload type is invalid".to_string())?
            != DeviceInboxPayloadType::ConversationEvent
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

        match event.payload.as_ref() {
            Some(conversation_event::Payload::MessageCommitted(message)) => self
                .process_message_committed(
                    item,
                    event,
                    message,
                    &delivery,
                    consumer_epoch,
                    now,
                    committed_at_unix_ms,
                ),
            Some(conversation_event::Payload::MessageEdited(fact)) => self.process_message_edited(
                item,
                event,
                fact,
                consumer_epoch,
                now,
                committed_at_unix_ms,
            ),
            Some(conversation_event::Payload::MessageRetracted(fact)) => self
                .process_message_retracted(
                    item,
                    event,
                    fact,
                    consumer_epoch,
                    now,
                    committed_at_unix_ms,
                ),
            Some(conversation_event::Payload::MessageHiddenForActor(fact)) => {
                self.process_message_hidden_for_actor(item, event, fact, consumer_epoch, now)
            }
            Some(conversation_event::Payload::ReactionCommitted(fact)) => {
                self.process_reaction(item, event, fact, consumer_epoch, now, committed_at_unix_ms)
            }
            Some(conversation_event::Payload::MessagePinCommitted(fact)) => {
                self.process_pin(item, event, fact, consumer_epoch, now, committed_at_unix_ms)
            }
            _ => Err("messaging public-event payload type is unsupported".to_string()),
        }
    }

    fn process_message_committed(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::model::chat::ConversationEvent,
        message: &crate::model::chat::MessageCommittedFact,
        delivery: &crate::model::chat::DeviceEventDelivery,
        consumer_epoch: u64,
        now: i64,
        committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        if MessagingContentKind::try_from(message.content_kind)
            .map_err(|_| "messaging public-event content kind is invalid".to_string())?
            != MessagingContentKind::Text
        {
            return Err("messaging public-event only accepts text projections".to_string());
        }
        let marker = PublicEventMarker::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging public-event marker is invalid".to_string())?;
        validate_marker_bindings(event, message, &marker, &self.endpoint)?;

        let receipt = self.build_receipt(item, event, now);
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
            attachments: &message.attachments,
            reply_to_message_id: (!message.reply_to_message_id.is_empty())
                .then_some(message.reply_to_message_id.as_str()),
            thread_root_message_id: (!message.thread_root_message_id.is_empty())
                .then_some(message.thread_root_message_id.as_str()),
            committed_at_unix_ms,
            receipt_id: &receipt.receipt_id,
            receipt_bytes: &receipt_bytes,
            consumed_at_unix_ms: now,
        })?;
        Ok(())
    }

    fn process_message_edited(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::model::chat::ConversationEvent,
        fact: &MessageEditedFact,
        consumer_epoch: u64,
        now: i64,
        committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        if fact.message_id.trim().is_empty() {
            return Err("messaging public-event edit has no message ID".to_string());
        }
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::Edit {
                edited_text: "",
                edited_at_unix_ms: committed_at_unix_ms,
            },
            now,
        )?;
        Ok(())
    }

    fn process_message_retracted(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::model::chat::ConversationEvent,
        fact: &MessageRetractedFact,
        consumer_epoch: u64,
        now: i64,
        _committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        if fact.message_id.trim().is_empty() {
            return Err("messaging public-event retract has no message ID".to_string());
        }
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::Retract,
            now,
        )?;
        Ok(())
    }

    fn process_message_hidden_for_actor(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::model::chat::ConversationEvent,
        fact: &MessageHiddenForActorFact,
        consumer_epoch: u64,
        now: i64,
    ) -> Result<(), String> {
        if fact.message_id.trim().is_empty() || fact.actor_ptid != self.endpoint.ptid {
            return Err("messaging actor-hide event is not bound to this actor".to_string());
        }
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::HideForActor,
            now,
        )?;
        Ok(())
    }

    fn process_reaction(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::model::chat::ConversationEvent,
        fact: &ReactionCommittedFact,
        consumer_epoch: u64,
        now: i64,
        committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        if fact.message_id.trim().is_empty() || fact.reaction.trim().is_empty() {
            return Err("messaging public-event reaction is incomplete".to_string());
        }
        let actor_ptid = fact
            .actor
            .as_ref()
            .map(|endpoint| endpoint.ptid.as_str())
            .unwrap_or(&self.endpoint.ptid);
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::Reaction {
                actor_ptid,
                reaction: &fact.reaction,
                removed: fact.removed,
                created_at_unix_ms: committed_at_unix_ms,
            },
            now,
        )?;
        Ok(())
    }

    fn process_pin(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::model::chat::ConversationEvent,
        fact: &MessagePinCommittedFact,
        consumer_epoch: u64,
        now: i64,
        committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        if fact.message_id.trim().is_empty() {
            return Err("messaging public-event pin has no message ID".to_string());
        }
        let actor_ptid = fact
            .actor
            .as_ref()
            .map(|endpoint| endpoint.ptid.as_str())
            .unwrap_or(&self.endpoint.ptid);
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::Pin {
                actor_ptid,
                removed: fact.removed,
                pinned_at_unix_ms: committed_at_unix_ms,
            },
            now,
        )?;
        Ok(())
    }

    fn commit_interaction(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::model::chat::ConversationEvent,
        consumer_epoch: u64,
        message_id: &str,
        mutation: InteractionMutation<'_>,
        now: i64,
    ) -> Result<ReceiveCommitResult, String> {
        let receipt = self.build_receipt(item, event, now);
        let receipt_bytes = receipt.encode_to_vec();
        self.store
            .commit_interaction_event(&InteractionReceiveCommit {
                item_id: &item.item_id,
                event_id: &event.event_id,
                command_id: &event.command_id,
                conversation_id: &event.conversation_id,
                event_sequence: event.sequence,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                event_hash: &event.event_hash,
                previous_event_hash: &event.previous_hash,
                message_id,
                mutation,
                mls_session_state: None,
                membership_epoch: event.membership_epoch,
                mls_epoch: event.mls_epoch,
                receipt_id: &receipt.receipt_id,
                receipt_bytes: &receipt_bytes,
                consumed_at_unix_ms: now,
            })
    }

    fn build_receipt(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::model::chat::ConversationEvent,
        now: i64,
    ) -> DeviceConsumptionReceipt {
        DeviceConsumptionReceipt {
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
        }
    }
}

impl ClaimedItemConsumer for PublicEventProcessor {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
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
    use crate::messaging::private_content::test_attachment_metadata;
    use crate::messaging::{AttachmentTransferRecord, DirectSendCommit, PendingSenderProjection};
    use crate::model::chat::{
        AttachmentPlaintextMetadata, AttachmentTransferState, ConversationEvent,
        DeviceEventDelivery, EncryptedObjectDescriptor, MessageCommittedFact, MessagingContentKind,
    };
    use messaging_core::proto::actor_device_from_chat_endpoint;
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

    fn queue_item_with_attachments(
        attachments: Vec<EncryptedObjectDescriptor>,
    ) -> DurableDeviceInboxItem {
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
            authority_station_peer_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MessageCommitted(
                MessageCommittedFact {
                    message_id: "message-1".to_string(),
                    sender: Some(endpoint.clone()),
                    content_kind: MessagingContentKind::Text as i32,
                    attachments,
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
        DurableDeviceInboxItem {
            item_id: "item-1".to_string(),
            recipient: Some(actor_device_from_chat_endpoint(&endpoint)),
            lane_sequence: 1,
            event_id: "event-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            idempotency_key: "event:event-1".to_string(),
            payload_type: DeviceInboxPayloadType::ConversationEvent as i32,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }

    fn queue_item() -> DurableDeviceInboxItem {
        queue_item_with_attachments(Vec::new())
    }

    fn actor_hide_queue_item(
        previous_event_hash: Vec<u8>,
        actor_ptid: &str,
    ) -> DurableDeviceInboxItem {
        let mut item = queue_item();
        item.item_id = "item-hide".to_string();
        item.event_id = "event-hide".to_string();
        item.idempotency_key = "event:event-hide".to_string();
        item.lane_sequence = 2;
        let mut delivery = DeviceEventDelivery::decode(item.opaque_payload.as_slice()).unwrap();
        let event = delivery.event.as_mut().unwrap();
        event.event_id = "event-hide".to_string();
        event.command_id = "command-hide".to_string();
        event.sequence = 2;
        event.previous_hash = previous_event_hash;
        event.payload = Some(conversation_event::Payload::MessageHiddenForActor(
            MessageHiddenForActorFact {
                message_id: "message-1".to_string(),
                actor_ptid: actor_ptid.to_string(),
                ..Default::default()
            },
        ));
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
        item
    }

    fn prepare_send_with_attachments(
        store: &MessagingStore,
        attachments: &[AttachmentPlaintextMetadata],
    ) {
        let private_content =
            crate::messaging::encode_message_private_content("exact sender plaintext", attachments)
                .unwrap();
        store
            .persist_direct_send(&DirectSendCommit {
                command_bytes: b"exact command bytes",
                expected_authority_sequence: 0,
                expected_authority_hash: &[],
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
                    reply_to_message_id: "",
                    thread_root_message_id: "",
                    attachments,
                    private_content: &private_content,
                    delivery_plan_sha256: &[1; 32],
                    created_at_unix_ms: 900,
                },
            })
            .unwrap();
    }

    fn prepare_send(store: &MessagingStore) {
        prepare_send_with_attachments(store, &[]);
    }

    #[test]
    fn marker_atomically_promotes_sender_projection_and_replay_skips_pending_lookup() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let attachment = test_attachment_metadata("attachment-1");
        prepare_send_with_attachments(&store, std::slice::from_ref(&attachment));
        let descriptor = attachment.object.as_ref().unwrap();
        let mut completed_chunk_bitmap = vec![0_u8; descriptor.chunk_count.div_ceil(8) as usize];
        for chunk_index in 0..descriptor.chunk_count {
            completed_chunk_bitmap[chunk_index as usize / 8] |= 1 << (chunk_index % 8);
        }
        let upload = AttachmentTransferRecord {
            attachment_id: attachment.attachment_id.clone(),
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            authority_station_id: "station-local".to_string(),
            direction: 1,
            state: AttachmentTransferState::Complete as i32,
            upload_id: "upload-1".to_string(),
            generation: 1,
            descriptor_sha256: Sha256::digest(descriptor.encode_to_vec()).to_vec(),
            completed_chunk_bitmap,
            source_local_ref: "/tmp/sender-source".to_string(),
            partial_local_ref: String::new(),
            object_key: attachment.object_key.clone(),
            base_nonce: attachment.base_nonce.clone(),
            plaintext_size: attachment.plaintext_size,
            chunk_size: descriptor.chunk_size,
            attempt_count: 0,
            next_attempt_at_unix_ms: 0,
            last_error_code: 0,
            updated_at_unix_ms: 900,
        };
        store.create_attachment_transfer(&upload).unwrap();
        let source = store
            .completed_sender_attachment_source(&attachment.attachment_id)
            .unwrap()
            .unwrap();
        store
            .promote_completed_upload_cache(&source, "/tmp/sender-cache")
            .unwrap();
        let processor = PublicEventProcessor::new(
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            now,
        )
        .unwrap();
        let item = queue_item_with_attachments(vec![attachment.object.clone().unwrap()]);
        processor.consume(&item, 3).unwrap();
        let (projection, state) = store
            .message_projection("conversation-1", "message-1")
            .unwrap()
            .unwrap();
        assert_eq!(projection.event_id, "event-1");
        assert_eq!(projection.plaintext, "exact sender plaintext");
        assert_eq!(projection.attachments, vec![attachment]);
        assert_eq!(state, "accepted");
        assert_eq!(
            store
                .completed_sender_attachment_source("attachment-1")
                .unwrap()
                .unwrap()
                .local_cache_path
                .as_deref(),
            Some("/tmp/sender-cache")
        );
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 3));
        assert!(store
            .consumption_marker_matches("item-1", &item.payload_sha256)
            .unwrap());
        assert!(store.next_command(1_000).unwrap().is_none());
        assert_eq!(
            store
                .search_message_projections("conversation-1", "report.txt", None, 10,)
                .unwrap()
                .len(),
            1
        );

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
    fn actor_hide_event_redacts_projection_and_advances_the_ack_cursor() {
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
        let committed = queue_item();
        let committed_delivery =
            DeviceEventDelivery::decode(committed.opaque_payload.as_slice()).unwrap();
        let committed_hash = committed_delivery.event.unwrap().event_hash;
        processor.consume(&committed, 3).unwrap();

        let hidden = actor_hide_queue_item(committed_hash, "ptid:alice");
        processor.consume(&hidden, 3).unwrap();

        assert!(store
            .conversation_message_projections("conversation-1")
            .unwrap()
            .is_empty());
        assert!(store
            .search_message_projections("conversation-1", "exact sender plaintext", None, 10)
            .unwrap()
            .is_empty());
        assert_eq!(store.lane_checkpoint().unwrap(), (2, 3));
        assert!(store
            .consumption_marker_matches("item-hide", &hidden.payload_sha256)
            .unwrap());
    }

    #[test]
    fn actor_hide_event_for_another_actor_is_not_acknowledged() {
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
        let committed = queue_item();
        let committed_delivery =
            DeviceEventDelivery::decode(committed.opaque_payload.as_slice()).unwrap();
        let committed_hash = committed_delivery.event.unwrap().event_hash;
        processor.consume(&committed, 3).unwrap();

        let hidden = actor_hide_queue_item(committed_hash, "ptid:bob");
        assert_eq!(
            processor.consume(&hidden, 3).unwrap_err(),
            "messaging actor-hide event is not bound to this actor"
        );

        assert_eq!(
            store
                .conversation_message_projections("conversation-1")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 3));
        assert!(!store
            .consumption_marker_matches("item-hide", &hidden.payload_sha256)
            .unwrap());
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
    fn attachment_descriptor_mismatch_rolls_back_sender_marker_uow() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let attachment = test_attachment_metadata("attachment-1");
        prepare_send_with_attachments(&store, std::slice::from_ref(&attachment));
        let processor = PublicEventProcessor::new(
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            now,
        )
        .unwrap();
        let mut mismatched_descriptor = attachment.object.clone().unwrap();
        mismatched_descriptor.object_id = "different-object".to_string();
        let item = queue_item_with_attachments(vec![mismatched_descriptor]);

        assert_eq!(
            processor.consume(&item, 3).unwrap_err(),
            "messaging public-event attachment descriptor mismatch"
        );
        assert!(store
            .message_projection("conversation-1", "message-1")
            .unwrap()
            .is_none());
        assert_eq!(store.lane_checkpoint().unwrap(), (0, 0));
        assert!(!store
            .consumption_marker_matches("item-1", &item.payload_sha256)
            .unwrap());
        assert_eq!(
            store
                .pending_sender_projection("command-1")
                .unwrap()
                .unwrap(),
            ("exact sender plaintext".to_string(), "pending".to_string())
        );
        assert_eq!(
            store.next_command(1_000).unwrap().unwrap().command_id,
            "command-1"
        );
        assert!(store
            .search_message_projections("conversation-1", "report.txt", None, 10)
            .unwrap()
            .is_empty());
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
