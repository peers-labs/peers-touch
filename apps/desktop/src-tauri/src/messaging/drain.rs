use crate::model::chat::{
    AcknowledgeDeviceInboxItemRequest, ClaimDeviceInboxRequest, ClaimDeviceInboxResponse,
    DurableDeviceInboxItem,
};
use messaging_core::proto::actor::ActorDeviceRef;
use messaging_core::proto::actor_device_ptid;
use std::sync::Arc;

pub type AcknowledgedItemObserver = Arc<dyn Fn(&DurableDeviceInboxItem) + Send + Sync>;
pub type ConsumerEpochObserver = Arc<dyn Fn(u64) + Send + Sync>;

pub trait QueueTransport {
    fn claim(&self, request: ClaimDeviceInboxRequest) -> Result<ClaimDeviceInboxResponse, String>;

    fn acknowledge(&self, request: AcknowledgeDeviceInboxItemRequest) -> Result<(), String>;
}

pub trait ClaimedItemConsumer {
    // Success means the local durable receive transaction committed.
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String>;
}

impl<C: ClaimedItemConsumer + ?Sized> ClaimedItemConsumer for Arc<C> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.as_ref().consume(item, consumer_epoch)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrainProgress {
    pub consumer_epoch: u64,
    pub cursor: i64,
    pub lane_head: i64,
    pub processed: usize,
}

pub struct QueueDrain<T, C> {
    transport: T,
    consumer: C,
    device: ActorDeviceRef,
    consumer_id: String,
    batch_limit: u32,
    consumer_epoch_observer: Option<ConsumerEpochObserver>,
    acknowledged_item_observer: Option<AcknowledgedItemObserver>,
}

impl<T: QueueTransport, C: ClaimedItemConsumer> QueueDrain<T, C> {
    pub fn new(
        transport: T,
        consumer: C,
        device: ActorDeviceRef,
        consumer_id: String,
        batch_limit: u32,
    ) -> Result<Self, String> {
        if actor_device_ptid(&device).is_err()
            || device.device_id.trim().is_empty()
            || consumer_id.trim().is_empty()
            || batch_limit == 0
            || batch_limit > 100
        {
            return Err("messaging drain configuration is invalid".to_string());
        }
        Ok(Self {
            transport,
            consumer,
            device,
            consumer_id,
            batch_limit,
            consumer_epoch_observer: None,
            acknowledged_item_observer: None,
        })
    }

    pub fn with_consumer_epoch_observer(mut self, observer: ConsumerEpochObserver) -> Self {
        self.consumer_epoch_observer = Some(observer);
        self
    }

    pub fn with_acknowledged_item_observer(mut self, observer: AcknowledgedItemObserver) -> Self {
        self.acknowledged_item_observer = Some(observer);
        self
    }

    pub fn drain_once(
        &self,
        cursor: i64,
        expected_consumer_epoch: u64,
    ) -> Result<DrainProgress, String> {
        if cursor < 0 {
            return Err("messaging drain cursor cannot be negative".to_string());
        }
        let response = self.transport.claim(ClaimDeviceInboxRequest {
            device: Some(self.device.clone()),
            consumer_id: self.consumer_id.clone(),
            expected_consumer_epoch,
            after_lane_sequence: cursor,
            batch_limit: self.batch_limit,
        })?;
        if response.consumer_epoch == 0
            || response.lane_head_sequence < response.acked_through_sequence
        {
            return Err("messaging claim response lane state is invalid".to_string());
        }
        if let Some(observer) = &self.consumer_epoch_observer {
            observer(response.consumer_epoch);
        }

        // Adopt server's acked_through as baseline when local cursor is behind
        // (happens after local DB rebuild while server retains acknowledgment state).
        let mut next_cursor = cursor.max(response.acked_through_sequence);
        let mut processed = 0;
        for item in &response.items {
            if item.lane_sequence != next_cursor + 1 {
                return Err("messaging claimed batch is not contiguous".to_string());
            }
            self.consumer.consume(item, response.consumer_epoch)?;
            self.transport
                .acknowledge(AcknowledgeDeviceInboxItemRequest {
                    device: Some(self.device.clone()),
                    item_id: item.item_id.clone(),
                    lane_sequence: item.lane_sequence,
                    consumer_epoch: response.consumer_epoch,
                    payload_sha256: item.payload_sha256.clone(),
                })?;
            if let Some(observer) = &self.acknowledged_item_observer {
                observer(item);
            }
            next_cursor = item.lane_sequence;
            processed += 1;
        }

        Ok(DrainProgress {
            consumer_epoch: response.consumer_epoch,
            cursor: next_cursor,
            lane_head: response.lane_head_sequence,
            processed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use messaging_core::proto::actor_device_ref;
    use std::cell::RefCell;

    fn device() -> ActorDeviceRef {
        actor_device_ref("ptid:alice", "device-1")
    }

    struct Transport {
        items: Vec<DurableDeviceInboxItem>,
        claims: RefCell<Vec<ClaimDeviceInboxRequest>>,
        acknowledgements: RefCell<Vec<AcknowledgeDeviceInboxItemRequest>>,
    }

    impl QueueTransport for Transport {
        fn claim(
            &self,
            request: ClaimDeviceInboxRequest,
        ) -> Result<ClaimDeviceInboxResponse, String> {
            self.claims.borrow_mut().push(request.clone());
            Ok(ClaimDeviceInboxResponse {
                consumer_epoch: 3,
                items: self
                    .items
                    .iter()
                    .filter(|item| item.lane_sequence > request.after_lane_sequence)
                    .cloned()
                    .collect(),
                lane_head_sequence: self.items.len() as i64,
                acked_through_sequence: request.after_lane_sequence,
            })
        }

        fn acknowledge(&self, request: AcknowledgeDeviceInboxItemRequest) -> Result<(), String> {
            self.acknowledgements.borrow_mut().push(request);
            Ok(())
        }
    }

    struct Consumer {
        fail_at: Option<i64>,
        consumed: RefCell<Vec<i64>>,
    }

    impl ClaimedItemConsumer for Consumer {
        fn consume(
            &self,
            item: &DurableDeviceInboxItem,
            _consumer_epoch: u64,
        ) -> Result<(), String> {
            if self.fail_at == Some(item.lane_sequence) {
                return Err("injected local commit failure".to_string());
            }
            self.consumed.borrow_mut().push(item.lane_sequence);
            Ok(())
        }
    }

    fn item(sequence: i64) -> DurableDeviceInboxItem {
        DurableDeviceInboxItem {
            item_id: format!("item-{sequence}"),
            event_id: format!("event-{sequence}"),
            conversation_id: "conversation-1".to_string(),
            lane_sequence: sequence,
            payload_sha256: vec![sequence as u8; 32],
            ..Default::default()
        }
    }

    #[test]
    fn projection_observer_runs_only_after_acknowledgement() {
        let observed = Arc::new(std::sync::Mutex::new(Vec::new()));
        let observer_state = observed.clone();
        let drain = QueueDrain::new(
            Transport {
                items: vec![item(1), item(2)],
                claims: RefCell::new(Vec::new()),
                acknowledgements: RefCell::new(Vec::new()),
            },
            Consumer {
                fail_at: None,
                consumed: RefCell::new(Vec::new()),
            },
            device(),
            "consumer-1".to_string(),
            10,
        )
        .unwrap()
        .with_acknowledged_item_observer(Arc::new(move |item| {
            observer_state.lock().unwrap().push((
                item.conversation_id.clone(),
                item.event_id.clone(),
                item.lane_sequence,
            ));
        }));

        drain.drain_once(0, 0).unwrap();

        assert_eq!(
            *observed.lock().unwrap(),
            vec![
                ("conversation-1".to_string(), "event-1".to_string(), 1),
                ("conversation-1".to_string(), "event-2".to_string(), 2),
            ]
        );
    }

    #[test]
    fn consumer_epoch_is_observed_before_item_processing() {
        let observed = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let observer_state = observed.clone();
        let drain = QueueDrain::new(
            Transport {
                items: vec![item(1)],
                claims: RefCell::new(Vec::new()),
                acknowledgements: RefCell::new(Vec::new()),
            },
            Consumer {
                fail_at: Some(1),
                consumed: RefCell::new(Vec::new()),
            },
            device(),
            "consumer-1".to_string(),
            10,
        )
        .unwrap()
        .with_consumer_epoch_observer(Arc::new(move |epoch| {
            observer_state.store(epoch, std::sync::atomic::Ordering::Release);
        }));

        assert!(drain.drain_once(0, 0).is_err());
        assert_eq!(
            observed.load(std::sync::atomic::Ordering::Acquire),
            3,
            "a failed item must not strand the worker on its pre-claim epoch"
        );
    }

    #[test]
    fn failure_stops_lane_before_ack_and_later_items() {
        let drain = QueueDrain::new(
            Transport {
                items: vec![item(1), item(2), item(3)],
                claims: RefCell::new(Vec::new()),
                acknowledgements: RefCell::new(Vec::new()),
            },
            Consumer {
                fail_at: Some(2),
                consumed: RefCell::new(Vec::new()),
            },
            device(),
            "consumer-1".to_string(),
            10,
        )
        .unwrap();

        assert!(drain.drain_once(0, 0).is_err());
        assert_eq!(*drain.consumer.consumed.borrow(), vec![1]);
        let acknowledgements = drain.transport.acknowledgements.borrow();
        assert_eq!(acknowledgements.len(), 1);
        assert_eq!(acknowledgements[0].lane_sequence, 1);
    }

    #[test]
    fn restart_resumes_after_durable_cursor() {
        let drain = QueueDrain::new(
            Transport {
                items: vec![item(1), item(2), item(3)],
                claims: RefCell::new(Vec::new()),
                acknowledgements: RefCell::new(Vec::new()),
            },
            Consumer {
                fail_at: None,
                consumed: RefCell::new(Vec::new()),
            },
            device(),
            "consumer-after-restart".to_string(),
            10,
        )
        .unwrap();
        let progress = drain.drain_once(1, 0).unwrap();
        assert_eq!(progress.cursor, 3);
        assert_eq!(progress.processed, 2);
        assert_eq!(*drain.consumer.consumed.borrow(), vec![2, 3]);
        assert_eq!(drain.transport.claims.borrow()[0].after_lane_sequence, 1);
    }

    #[test]
    fn non_contiguous_batch_fails_closed() {
        let drain = QueueDrain::new(
            Transport {
                items: vec![item(1), item(3)],
                claims: RefCell::new(Vec::new()),
                acknowledgements: RefCell::new(Vec::new()),
            },
            Consumer {
                fail_at: None,
                consumed: RefCell::new(Vec::new()),
            },
            device(),
            "consumer-1".to_string(),
            10,
        )
        .unwrap();
        assert!(drain.drain_once(0, 0).is_err());
        assert_eq!(*drain.consumer.consumed.borrow(), vec![1]);
        assert_eq!(drain.transport.acknowledgements.borrow().len(), 1);
    }
}
