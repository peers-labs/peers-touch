use crate::contracts::{CryptoEndpoint, RejectedItemReceiveCommit};
use crate::inbox::{
    ClaimedItemConsumer, ConsumeError, ItemRejectionCode,
};
use crate::proto::chat::{
    DeviceInboxItemRejectReason, DeviceRejectedItemReceipt, DurableDeviceInboxItem,
};
use crate::store::MessagingRepository;
use prost::Message;
use std::sync::Arc;

/// Consumer decorator that converts a permanent item rejection into a durable
/// local dead-letter record before the drain acks past it.
///
/// Contract honoured by [`crate::inbox::QueueDrain`]: when [`consume`] returns
/// a [`ConsumeError`] with `is_permanent()`, the rejection record committed
/// here is already durable. A failure while committing it degrades the error
/// back to retryable, so the drain cannot ack an item that was not recorded.
/// Retryable inner failures pass through untouched and keep blocking the lane
/// as required.
pub struct QuarantiningConsumer<C, R: MessagingRepository> {
    inner: C,
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<C, R: MessagingRepository> QuarantiningConsumer<C, R> {
    pub fn new(
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        inner: C,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging quarantine consumer requires complete endpoint".to_string());
        }
        Ok(Self {
            inner,
            store,
            endpoint,
            clock,
        })
    }
}

impl<C, R> ClaimedItemConsumer for QuarantiningConsumer<C, R>
where
    C: ClaimedItemConsumer,
    R: MessagingRepository,
{
    fn consume(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<(), ConsumeError> {
        let error = match self.inner.consume(item, consumer_epoch) {
            Ok(()) => return Ok(()),
            Err(error) => error,
        };
        let code = match error.rejection_code() {
            Some(code) => code,
            // Retryable failure: leave the item claimed for the next drain.
            None => return Err(error),
        };

        // The raw queue item must survive quarantine even when the failure
        // happens before an inner processor persisted it (e.g. an envelope
        // that fails to decode). Idempotent on replays.
        self.store
            .persist_claimed_item(
                &item.item_id,
                &item.event_id,
                &item.conversation_id,
                item.lane_sequence,
                consumer_epoch,
                &item.payload_sha256,
                &item.opaque_payload,
                (self.clock)(),
            )
            .map_err(ConsumeError::from)?;
        if self
            .store
            .consumption_marker_matches(&item.item_id, &item.payload_sha256)
            .map_err(ConsumeError::from)?
        {
            // Quarantine already committed on an earlier attempt that crashed
            // before the ack; surface the rejection so the drain acks now.
            return Err(error);
        }

        let now = (self.clock)();
        let receipt_id = format!("device-rejected:{}", item.item_id);
        let receipt = DeviceRejectedItemReceipt {
            receipt_id: receipt_id.clone(),
            item_id: item.item_id.clone(),
            conversation_id: item.conversation_id.clone(),
            event_id: item.event_id.clone(),
            consumer: Some(crate::proto::chat::CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            }),
            lane_sequence: item.lane_sequence,
            payload_sha256: item.payload_sha256.clone(),
            reason: wire_rejection_reason(code) as i32,
            detail: error.message().to_string(),
            rejected_at: Some(prost_types::Timestamp {
                seconds: now.div_euclid(1_000),
                nanos: (now.rem_euclid(1_000) * 1_000_000) as i32,
            }),
        };
        let receipt_bytes = receipt.encode_to_vec();

        self.store
            .commit_rejected_endpoint_payload(&RejectedItemReceiveCommit {
                item_id: &item.item_id,
                event_id: &item.event_id,
                conversation_id: &item.conversation_id,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                reject_code: code.as_wire_name(),
                reject_detail: error.message(),
                receipt_id: &receipt.receipt_id,
                receipt_bytes: &receipt_bytes,
                rejected_at_unix_ms: now,
            })
            .map_err(ConsumeError::from)?;
        Err(error)
    }
}

fn wire_rejection_reason(code: ItemRejectionCode) -> DeviceInboxItemRejectReason {
    match code {
        ItemRejectionCode::PayloadInvalid => DeviceInboxItemRejectReason::PayloadInvalid,
        ItemRejectionCode::IntegrityFailed => DeviceInboxItemRejectReason::IntegrityFailed,
        ItemRejectionCode::RecipientMismatch => DeviceInboxItemRejectReason::RecipientMismatch,
    }
}
