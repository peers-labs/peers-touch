use crate::contracts::{ActorReadReceiveCommit, CryptoEndpoint, DeliveryReceiptReceiveCommit};
use crate::proto::chat::{
    ActorReadCursor, DeviceInboxPayloadType, DurableDeviceInboxItem, MessageReceipt, ReceiptType,
};
use crate::proto::crypto_endpoint_from_actor_device_ref;
use crate::store::MessagingRepository;

use super::ClaimedItemConsumer;
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub struct DeliveryReceiptProcessor<R> {
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: MessagingRepository> DeliveryReceiptProcessor<R> {
    pub fn new(
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err(
                "messaging delivery receipt processor requires complete endpoint".to_string(),
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
        if DeviceInboxPayloadType::try_from(item.payload_type).ok()
            != Some(DeviceInboxPayloadType::DeviceReceipt)
        {
            return Err("messaging delivery receipt queue type is invalid".to_string());
        }
        let recipient = item
            .recipient
            .as_ref()
            .and_then(crypto_endpoint_from_actor_device_ref)
            .ok_or_else(|| "messaging delivery receipt recipient is missing".to_string())?;
        if recipient.ptid != self.endpoint.ptid || recipient.device_id != self.endpoint.device_id {
            return Err("messaging delivery receipt endpoint mismatch".to_string());
        }
        if item.payload_sha256.len() != 32
            || Sha256::digest(&item.opaque_payload).as_slice() != item.payload_sha256
        {
            return Err("messaging delivery receipt payload hash mismatch".to_string());
        }
        if item.event_id.starts_with("read:") {
            let cursor = ActorReadCursor::decode(item.opaque_payload.as_slice())
                .map_err(|error| format!("decode messaging actor read cursor: {error}"))?;
            if cursor.conversation_id != item.conversation_id
                || cursor.reader_ptid.is_empty()
                || cursor.reader_ptid == self.endpoint.ptid
                || cursor.last_read_sequence <= 0
            {
                return Err("messaging actor read cursor payload is invalid".to_string());
            }
            self.store
                .commit_actor_read_cursor(&ActorReadReceiveCommit {
                    item_id: &item.item_id,
                    event_id: &item.event_id,
                    conversation_id: &cursor.conversation_id,
                    reader_ptid: &cursor.reader_ptid,
                    last_read_sequence: cursor.last_read_sequence,
                    lane_sequence: item.lane_sequence,
                    consumer_epoch,
                    payload_sha256: &item.payload_sha256,
                    consumed_at_unix_ms: now,
                })?;
            return Ok(());
        }
        let receipt = MessageReceipt::decode(item.opaque_payload.as_slice())
            .map_err(|error| format!("decode messaging delivery receipt: {error}"))?;
        if receipt.receipt_type != ReceiptType::Delivered as i32
            || receipt.conversation_id != item.conversation_id
            || receipt.message_id != item.event_id
            || receipt.ptid.is_empty()
            || receipt.device_id.is_empty()
            || receipt.ptid == self.endpoint.ptid
        {
            return Err("messaging delivery receipt payload is invalid".to_string());
        }
        self.store
            .commit_delivery_receipt(&DeliveryReceiptReceiveCommit {
                item_id: &item.item_id,
                message_id: &receipt.message_id,
                conversation_id: &receipt.conversation_id,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                delivery_state: "delivered",
                consumed_at_unix_ms: now,
            })?;
        Ok(())
    }
}

impl<R: MessagingRepository> ClaimedItemConsumer for DeliveryReceiptProcessor<R> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}
