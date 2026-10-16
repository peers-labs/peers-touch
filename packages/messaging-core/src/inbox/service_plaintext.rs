use crate::codec::verification::verify_device_event_delivery;
use crate::contracts::{
    CryptoEndpoint, ReceiveCommitResult, ServicePlaintextMessageContent,
    ServicePlaintextReceiveCommit,
};
use crate::proto::chat::{
    conversation_event, DeviceConsumptionReceipt, DeviceInboxPayloadType,
    DirectServicePlaintextPayload, DurableDeviceInboxItem, MessageDeliverySecurity,
    MessagingContentKind, PreparedEndpointPayloadKind,
};
use crate::store::MessagingRepository;

use super::ClaimedItemConsumer;
use prost::Message;
use std::sync::Arc;

/// Reserved Station device that authors every service-plaintext message. It
/// mirrors the Station aggregate constant and never appears as a real enrolled
/// endpoint, so the bot actor needs no device keys.
pub const SERVICE_SYSTEM_DEVICE_ID: &str = "station-system";

/// Receives non-E2EE, Station-resident direct_service_plaintext messages.
/// There is no crypto session: the authority event chain,
/// delivery commitment and recipient bindings are still fully verified before
/// the readable payload is projected as an ordinary direct message.
pub struct ServicePlaintextProcessor<R: MessagingRepository> {
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: MessagingRepository> ServicePlaintextProcessor<R> {
    pub fn new(
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err(
                "messaging service-plaintext processor requires complete endpoint".to_string(),
            );
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
            .map_err(|_| "messaging service-plaintext queue payload type is invalid".to_string())?
            != DeviceInboxPayloadType::ConversationEvent
        {
            return Err(
                "messaging service-plaintext processor received wrong queue payload type"
                    .to_string(),
            );
        }

        let delivery =
            verify_device_event_delivery(item, &self.endpoint.ptid, &self.endpoint.device_id)?;
        if PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging service-plaintext payload kind is invalid".to_string())?
            != PreparedEndpointPayloadKind::DirectServicePlaintext
        {
            return Err(
                "messaging service-plaintext processor received wrong endpoint payload kind"
                    .to_string(),
            );
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging service-plaintext delivery has no event".to_string())?;
        let message = match event.payload.as_ref() {
            Some(conversation_event::Payload::MessageCommitted(message)) => message,
            _ => {
                return Err(
                    "messaging service-plaintext delivery has unsupported event type".to_string(),
                )
            }
        };
        if MessagingContentKind::try_from(message.content_kind)
            .map_err(|_| "messaging service-plaintext content kind is invalid".to_string())?
            != MessagingContentKind::System
            || MessageDeliverySecurity::try_from(message.delivery_security)
                .map_err(|_| "messaging service-plaintext security marker is invalid".to_string())?
                != MessageDeliverySecurity::ServicePlaintext
        {
            return Err(
                "messaging service-plaintext fact must be SYSTEM/SERVICE_PLAINTEXT".to_string(),
            );
        }
        if message.message_id.trim().is_empty() {
            return Err("messaging service-plaintext fact has no message ID".to_string());
        }
        let sender = message
            .sender
            .as_ref()
            .ok_or_else(|| "messaging service-plaintext fact has no sender".to_string())?;
        if event.actor.as_ref() != Some(sender)
            || sender.ptid.trim().is_empty()
            || sender.device_id != SERVICE_SYSTEM_DEVICE_ID
        {
            return Err(
                "messaging service-plaintext sender is not the reserved system endpoint"
                    .to_string(),
            );
        }

        let payload = DirectServicePlaintextPayload::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging service-plaintext payload is invalid".to_string())?;
        let content = payload
            .message_content
            .ok_or_else(|| "messaging service-plaintext payload has no content".to_string())?;
        if content.fallback_text.trim().is_empty() || content.primary.is_none() {
            return Err("messaging service-plaintext content is incomplete".to_string());
        }
        if payload.source_namespace.trim().is_empty() {
            return Err("messaging service-plaintext source namespace is required".to_string());
        }

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

        let projection = ServicePlaintextMessageContent {
            conversation_id: event.conversation_id.clone(),
            event_id: event.event_id.clone(),
            event_sequence: event.sequence,
            message_id: message.message_id.clone(),
            sender_ptid: sender.ptid.clone(),
            sender_device_id: sender.device_id.clone(),
            fallback_text: content.fallback_text.clone(),
            source_namespace: payload.source_namespace,
            content,
            source_context: payload.source_context,
            committed_at_unix_ms,
        };
        let receipt = DeviceConsumptionReceipt {
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
        };
        let receipt_bytes = receipt.encode_to_vec();
        let result =
            self.store
                .commit_service_plaintext_receive(&ServicePlaintextReceiveCommit {
                    item_id: &item.item_id,
                    event_id: &event.event_id,
                    conversation_id: &event.conversation_id,
                    lane_sequence: item.lane_sequence,
                    consumer_epoch,
                    payload_sha256: &item.payload_sha256,
                    event_hash: &event.event_hash,
                    previous_event_hash: &event.previous_hash,
                    event_sequence: event.sequence,
                    projection: &projection,
                    receipt_id: &receipt.receipt_id,
                    receipt_bytes: &receipt_bytes,
                    consumed_at_unix_ms: now,
                })?;
        debug_assert!(matches!(
            result,
            ReceiveCommitResult::Committed | ReceiveCommitResult::AlreadyCommitted
        ));
        Ok(())
    }
}

impl<R: MessagingRepository> ClaimedItemConsumer for ServicePlaintextProcessor<R> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}
