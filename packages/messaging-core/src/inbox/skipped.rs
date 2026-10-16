use crate::codec::verification::verify_device_event_delivery_any_kind;
use crate::contracts::{CryptoEndpoint, SkippedEndpointReceiveCommit};
use crate::proto::chat::{
    DeviceConsumptionReceipt, DeviceInboxPayloadType, DurableDeviceInboxItem,
};
use crate::store::MessagingRepository;

use super::ClaimedItemConsumer;
use prost::Message;
use std::sync::Arc;

/// Forward-compatible sink for endpoint payload kinds this build does not
/// understand. The item is fully verified and the authority hash chain is
/// advanced, but no message projection is created and the drain acks the item
/// normally, so a future wire kind cannot poison the device lane on older
/// clients (G-BOT-10). Known kinds are never routed here.
pub struct SkippedPayloadProcessor<R: MessagingRepository> {
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: MessagingRepository> SkippedPayloadProcessor<R> {
    pub fn new(
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err(
                "messaging skipped-payload processor requires complete endpoint".to_string(),
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
            .map_err(|_| "messaging skipped-payload queue payload type is invalid".to_string())?
            != DeviceInboxPayloadType::ConversationEvent
        {
            return Err(
                "messaging skipped-payload processor received wrong queue payload type".to_string(),
            );
        }

        // Verification accepts unknown numeric kinds while still enforcing the
        // recipient binding, payload hash, authority event hash and delivery
        // commitment. A recognized kind routed here is a dispatcher bug.
        let (delivery, kind) = verify_device_event_delivery_any_kind(
            item,
            &self.endpoint.ptid,
            &self.endpoint.device_id,
        )?;
        if kind.is_some() {
            return Err(
                "messaging skipped-payload processor must only receive unknown payload kinds"
                    .to_string(),
            );
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging skipped-payload delivery has no event".to_string())?;

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
        self.store
            .commit_skipped_endpoint_payload(&SkippedEndpointReceiveCommit {
                item_id: &item.item_id,
                event_id: &event.event_id,
                conversation_id: &event.conversation_id,
                event_sequence: event.sequence,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                event_hash: &event.event_hash,
                previous_event_hash: &event.previous_hash,
                receipt_id: &receipt.receipt_id,
                receipt_bytes: &receipt_bytes,
                consumed_at_unix_ms: now,
            })?;
        Ok(())
    }
}

impl<R: MessagingRepository> ClaimedItemConsumer for SkippedPayloadProcessor<R> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}
