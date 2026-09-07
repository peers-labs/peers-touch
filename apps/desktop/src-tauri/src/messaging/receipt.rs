use super::{
    ActorReadReceiveCommit, ClaimedItemConsumer, DeliveryReceiptReceiveCommit, EngineEndpoint,
    MessagingStore,
};
use crate::model::chat::{
    ActorReadCursor, DeviceInboxPayloadType, DurableDeviceInboxItem, MessageReceipt, ReceiptType,
};
use messaging_core::proto::actor_device_ptid;
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub struct DeliveryReceiptProcessor {
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
    clock: fn() -> i64,
}

impl DeliveryReceiptProcessor {
    pub fn new(
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
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
            .ok_or_else(|| "messaging delivery receipt recipient is missing".to_string())?;
        if actor_device_ptid(recipient)? != self.endpoint.ptid
            || recipient.device_id != self.endpoint.device_id
        {
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

impl ClaimedItemConsumer for DeliveryReceiptProcessor {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use messaging_core::proto::actor_device_ref;

    fn now() -> i64 {
        1_700_000_000_000
    }

    fn processor(store: Arc<MessagingStore>) -> DeliveryReceiptProcessor {
        DeliveryReceiptProcessor::new(
            store,
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            now,
        )
        .unwrap()
    }

    fn receipt_item(
        sender_ptid: &str,
        recipient_ptid: &str,
        receipt_type: ReceiptType,
    ) -> DurableDeviceInboxItem {
        let receipt = MessageReceipt {
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            ptid: sender_ptid.to_string(),
            device_id: "bob-device".to_string(),
            receipt_type: receipt_type as i32,
            ts: None,
        };
        let payload = receipt.encode_to_vec();
        DurableDeviceInboxItem {
            item_id: "receipt-item-1".to_string(),
            recipient: Some(actor_device_ref(recipient_ptid, "alice-device")),
            lane_sequence: 1,
            event_id: "message-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            payload_type: DeviceInboxPayloadType::DeviceReceipt as i32,
            payload_sha256: Sha256::digest(&payload).to_vec(),
            opaque_payload: payload,
            ..DurableDeviceInboxItem::default()
        }
    }

    fn actor_read_item(reader_ptid: &str, sequence: i64) -> DurableDeviceInboxItem {
        let cursor = ActorReadCursor {
            conversation_id: "conversation-1".to_string(),
            reader_ptid: reader_ptid.to_string(),
            last_read_sequence: sequence,
            updated_at: None,
        };
        let payload = cursor.encode_to_vec();
        DurableDeviceInboxItem {
            item_id: "read-item-1".to_string(),
            recipient: Some(actor_device_ref("ptid:alice", "alice-device")),
            lane_sequence: 1,
            event_id: format!("read:{reader_ptid}:{sequence}"),
            conversation_id: "conversation-1".to_string(),
            payload_type: DeviceInboxPayloadType::DeviceReceipt as i32,
            payload_sha256: Sha256::digest(&payload).to_vec(),
            opaque_payload: payload,
            ..DurableDeviceInboxItem::default()
        }
    }

    fn insert_projection(store: &MessagingStore, state: &str) {
        store
            .insert_test_message_projection("conversation-1", "message-1", state)
            .unwrap();
    }

    #[test]
    fn commits_delivered_projection_marker_and_lane_atomically() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        insert_projection(&store, "accepted");
        let processor = processor(store.clone());
        let item = receipt_item("ptid:bob", "ptid:alice", ReceiptType::Delivered);

        processor.consume(&item, 3).unwrap();

        assert_eq!(
            store
                .message_projection("conversation-1", "message-1")
                .unwrap()
                .unwrap()
                .1,
            "delivered"
        );
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 3));
        assert!(store
            .consumption_marker_matches(&item.item_id, &item.payload_sha256)
            .unwrap());
        processor.consume(&item, 3).unwrap();
    }

    #[test]
    fn delivered_receipt_does_not_regress_read_projection() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        insert_projection(&store, "read");
        let processor = processor(store.clone());
        let item = receipt_item("ptid:bob", "ptid:alice", ReceiptType::Delivered);

        processor.consume(&item, 3).unwrap();

        assert_eq!(
            store
                .message_projection("conversation-1", "message-1")
                .unwrap()
                .unwrap()
                .1,
            "read"
        );
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 3));
    }

    #[test]
    fn actor_read_cursor_commits_cursor_marker_and_lane_atomically() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        insert_projection(&store, "delivered");
        let processor = processor(store.clone());
        let item = actor_read_item("ptid:bob", 7);

        processor.consume(&item, 3).unwrap();

        assert_eq!(
            store.read_cursor("conversation-1", "ptid:bob").unwrap(),
            Some(7)
        );
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 3));
        let messages = store
            .conversation_message_projections("conversation-1")
            .unwrap();
        assert_eq!(messages[0].state, "read");
        assert_eq!(messages[0].read_by_ptids, vec!["ptid:bob"]);
        assert!(store
            .consumption_marker_matches(&item.item_id, &item.payload_sha256)
            .unwrap());
        processor.consume(&item, 3).unwrap();
    }

    #[test]
    fn rejects_receipt_for_an_unknown_message() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let processor = processor(store);
        let item = receipt_item("ptid:bob", "ptid:alice", ReceiptType::Delivered);

        assert_eq!(
            processor.consume(&item, 1).unwrap_err(),
            "messaging delivery receipt references an unknown message"
        );
    }

    #[test]
    fn rejects_wrong_endpoint_type_and_self_receipt() {
        for item in [
            receipt_item("ptid:bob", "ptid:mallory", ReceiptType::Delivered),
            receipt_item("ptid:bob", "ptid:alice", ReceiptType::Read),
            receipt_item("ptid:alice", "ptid:alice", ReceiptType::Delivered),
        ] {
            let store = Arc::new(MessagingStore::in_memory().unwrap());
            insert_projection(&store, "accepted");
            let error = processor(store).consume(&item, 1).unwrap_err();
            assert!(
                error.contains("endpoint mismatch") || error.contains("payload is invalid"),
                "unexpected error: {error}"
            );
        }
    }
}
