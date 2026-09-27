use crate::contracts::{ActorReadReceiveCommit, CryptoEndpoint, DeliveryReceiptReceiveCommit};
use crate::proto::actor_device_ptid;
use crate::proto::chat::{
    ActorReadCursor, DeviceInboxPayloadType, DurableDeviceInboxItem, MessageReceipt, ReceiptType,
};
use crate::store::MessagingRepository;

use super::ClaimedItemConsumer;
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq)]
pub enum DeviceReceiptPayload {
    ActorReadCursor(ActorReadCursor),
    MessageReceipt(MessageReceipt),
}

pub fn decode_device_receipt_payload(
    item: &DurableDeviceInboxItem,
    endpoint_ptid: &str,
    endpoint_device_id: &str,
) -> Result<DeviceReceiptPayload, String> {
    if DeviceInboxPayloadType::try_from(item.payload_type).ok()
        != Some(DeviceInboxPayloadType::DeviceReceipt)
    {
        return Err("messaging delivery receipt queue type is invalid".to_string());
    }
    let recipient = item
        .recipient
        .as_ref()
        .ok_or_else(|| "messaging delivery receipt recipient is missing".to_string())?;
    if actor_device_ptid(recipient)? != endpoint_ptid || recipient.device_id != endpoint_device_id {
        return Err("messaging delivery receipt endpoint mismatch".to_string());
    }
    if item.payload_sha256.len() != 32
        || Sha256::digest(&item.opaque_payload).as_slice() != item.payload_sha256
    {
        return Err("messaging delivery receipt payload hash mismatch".to_string());
    }
    if item.event_id == hex::encode(&item.payload_sha256) {
        let cursor = ActorReadCursor::decode(item.opaque_payload.as_slice())
            .map_err(|error| format!("decode messaging actor read cursor: {error}"))?;
        if cursor.encode_to_vec() != item.opaque_payload
            || cursor.conversation_id != item.conversation_id
            || cursor.reader_ptid.is_empty()
            || cursor.last_read_sequence <= 0
        {
            return Err("messaging actor read cursor payload is invalid".to_string());
        }
        return Ok(DeviceReceiptPayload::ActorReadCursor(cursor));
    }
    let receipt = MessageReceipt::decode(item.opaque_payload.as_slice())
        .map_err(|error| format!("decode messaging delivery receipt: {error}"))?;
    if receipt.encode_to_vec() != item.opaque_payload
        || receipt.receipt_type != ReceiptType::Delivered as i32
        || receipt.conversation_id != item.conversation_id
        || receipt.message_id != item.event_id
        || receipt.ptid.is_empty()
        || receipt.device_id.is_empty()
        || receipt.ptid == endpoint_ptid
    {
        return Err("messaging delivery receipt payload is invalid".to_string());
    }
    Ok(DeviceReceiptPayload::MessageReceipt(receipt))
}

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
        match decode_device_receipt_payload(item, &self.endpoint.ptid, &self.endpoint.device_id)? {
            DeviceReceiptPayload::ActorReadCursor(cursor) => {
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
            }
            DeviceReceiptPayload::MessageReceipt(receipt) => {
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
            }
        }
        Ok(())
    }
}

impl<R: MessagingRepository> ClaimedItemConsumer for DeliveryReceiptProcessor<R> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::actor_device_ref;

    fn read_cursor_item() -> DurableDeviceInboxItem {
        let cursor = ActorReadCursor {
            conversation_id: "conversation-1".to_string(),
            reader_ptid: "ptid:bob".to_string(),
            last_read_sequence: 7,
            updated_at: None,
        };
        let payload = cursor.encode_to_vec();
        let payload_sha256 = Sha256::digest(&payload).to_vec();
        DurableDeviceInboxItem {
            recipient: Some(actor_device_ref("ptid:alice", "alice-device")),
            event_id: hex::encode(&payload_sha256),
            conversation_id: "conversation-1".to_string(),
            payload_type: DeviceInboxPayloadType::DeviceReceipt as i32,
            payload_sha256,
            opaque_payload: payload,
            ..DurableDeviceInboxItem::default()
        }
    }

    fn delivery_receipt_item() -> DurableDeviceInboxItem {
        let receipt = MessageReceipt {
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            ptid: "ptid:bob".to_string(),
            device_id: "bob-device".to_string(),
            receipt_type: ReceiptType::Delivered as i32,
            ts: None,
        };
        let payload = receipt.encode_to_vec();
        DurableDeviceInboxItem {
            recipient: Some(actor_device_ref("ptid:alice", "alice-device")),
            event_id: "message-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            payload_type: DeviceInboxPayloadType::DeviceReceipt as i32,
            payload_sha256: Sha256::digest(&payload).to_vec(),
            opaque_payload: payload,
            ..DurableDeviceInboxItem::default()
        }
    }

    #[test]
    fn decodes_canonical_actor_read_cursor_identity() {
        let item = read_cursor_item();

        assert!(matches!(
            decode_device_receipt_payload(&item, "ptid:alice", "alice-device").unwrap(),
            DeviceReceiptPayload::ActorReadCursor(cursor)
                if cursor.reader_ptid == "ptid:bob" && cursor.last_read_sequence == 7
        ));
    }

    #[test]
    fn decodes_same_actor_companion_read_cursor() {
        let mut item = read_cursor_item();
        item.recipient = Some(actor_device_ref("ptid:bob", "bob-companion-device"));

        assert!(matches!(
            decode_device_receipt_payload(
                &item,
                "ptid:bob",
                "bob-companion-device"
            )
            .unwrap(),
            DeviceReceiptPayload::ActorReadCursor(cursor)
                if cursor.reader_ptid == "ptid:bob" && cursor.last_read_sequence == 7
        ));
    }

    #[test]
    fn decodes_canonical_delivery_receipt_identity() {
        let item = delivery_receipt_item();

        assert!(matches!(
            decode_device_receipt_payload(&item, "ptid:alice", "alice-device").unwrap(),
            DeviceReceiptPayload::MessageReceipt(receipt)
                if receipt.message_id == "message-1"
                    && receipt.receipt_type == ReceiptType::Delivered as i32
        ));
    }

    #[test]
    fn rejects_legacy_actor_read_cursor_identity() {
        let mut item = read_cursor_item();
        item.event_id = "read:ptid:bob:7".to_string();

        assert!(
            decode_device_receipt_payload(&item, "ptid:alice", "alice-device")
                .unwrap_err()
                .starts_with("decode messaging delivery receipt:"),
            "legacy read-cursor identity was accepted"
        );
    }
}
