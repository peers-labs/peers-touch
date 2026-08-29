use crate::codec::verification::verify_device_event_delivery;
use crate::contracts::{
    CryptoEndpoint, InteractionMutation, InteractionReceiveCommit, PublicEventReceiveCommit,
    ReceiveCommitResult,
};
use crate::proto::chat::{
    conversation_event, DeviceConsumptionReceipt, DeviceQueueItem, DeviceQueuePayloadType,
    MessageEditedFact, MessagePinCommittedFact, MessageRetractedFact, MessagingContentKind,
    PreparedEndpointPayloadKind, PublicEventMarker, ReactionCommittedFact,
};
use crate::store::MessagingRepository;

use super::ClaimedItemConsumer;
use prost::Message;
use std::sync::Arc;

pub struct PublicEventProcessor<R> {
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: MessagingRepository> PublicEventProcessor<R> {
    pub fn new(
        store: Arc<R>,
        endpoint: CryptoEndpoint,
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
            Some(conversation_event::Payload::MessageRetracted(fact)) => {
                self.process_message_retracted(item, event, fact, consumer_epoch, now)
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
        item: &DeviceQueueItem,
        event: &crate::proto::chat::ConversationEvent,
        message: &crate::proto::chat::MessageCommittedFact,
        delivery: &crate::proto::chat::DeviceEventDelivery,
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
        item: &DeviceQueueItem,
        event: &crate::proto::chat::ConversationEvent,
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
        item: &DeviceQueueItem,
        event: &crate::proto::chat::ConversationEvent,
        fact: &MessageRetractedFact,
        consumer_epoch: u64,
        now: i64,
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

    fn process_reaction(
        &self,
        item: &DeviceQueueItem,
        event: &crate::proto::chat::ConversationEvent,
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
        item: &DeviceQueueItem,
        event: &crate::proto::chat::ConversationEvent,
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
        item: &DeviceQueueItem,
        event: &crate::proto::chat::ConversationEvent,
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
        item: &DeviceQueueItem,
        event: &crate::proto::chat::ConversationEvent,
        now: i64,
    ) -> DeviceConsumptionReceipt {
        DeviceConsumptionReceipt {
            receipt_id: format!("device-consumed:{}", item.item_id),
            conversation_id: event.conversation_id.clone(),
            event_id: event.event_id.clone(),
            consumer: Some(crate::proto::chat::CryptoEndpoint {
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

impl<R: MessagingRepository> ClaimedItemConsumer for PublicEventProcessor<R> {
    fn consume(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

fn validate_marker_bindings(
    event: &crate::proto::chat::ConversationEvent,
    message: &crate::proto::chat::MessageCommittedFact,
    marker: &PublicEventMarker,
    endpoint: &CryptoEndpoint,
) -> Result<(), String> {
    let local = crate::proto::chat::CryptoEndpoint {
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
