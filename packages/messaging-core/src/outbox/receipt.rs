use std::sync::Arc;

use prost::Message;

use crate::contracts::CryptoEndpoint;
use crate::proto::chat::DeviceConsumptionReceipt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryReceiptOutboxEntry {
    pub receipt_id: String,
    pub receipt_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code}: {detail}")]
pub struct DeliveryReceiptSubmitFailure {
    pub code: String,
    pub detail: String,
    pub retryable: bool,
}

impl DeliveryReceiptSubmitFailure {
    pub fn retryable(code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
            retryable: true,
        }
    }

    pub fn terminal(code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
            retryable: false,
        }
    }
}

pub trait DeliveryReceiptRepository: Send + Sync {
    fn next_delivery_receipt(&self) -> Result<Option<DeliveryReceiptOutboxEntry>, String>;

    fn mark_delivery_receipt_submitted(
        &self,
        receipt_id: &str,
        receipt_bytes: &[u8],
    ) -> Result<(), String>;

    fn mark_delivery_receipt_rejected(
        &self,
        receipt_id: &str,
        receipt_bytes: &[u8],
        error_code: &str,
    ) -> Result<(), String>;
}

pub trait DeliveryReceiptTransport: Send + Sync {
    fn submit(
        &self,
        receipt: &DeviceConsumptionReceipt,
    ) -> Result<(), DeliveryReceiptSubmitFailure>;
}

pub struct DeliveryReceiptDispatcher<R> {
    repository: Arc<R>,
    endpoint: CryptoEndpoint,
}

impl<R: DeliveryReceiptRepository> DeliveryReceiptDispatcher<R> {
    pub fn new(repository: Arc<R>, endpoint: CryptoEndpoint) -> Result<Self, String> {
        endpoint.validate()?;
        Ok(Self {
            repository,
            endpoint,
        })
    }

    pub fn dispatch_once<T: DeliveryReceiptTransport>(
        &self,
        transport: &T,
    ) -> Result<bool, String> {
        let Some(entry) = self.repository.next_delivery_receipt()? else {
            return Ok(false);
        };
        let receipt = DeviceConsumptionReceipt::decode(entry.receipt_bytes.as_slice())
            .map_err(|error| format!("decode messaging device consumption receipt: {error}"))?;
        validate_receipt(&receipt, &entry.receipt_id, &self.endpoint)?;
        match transport.submit(&receipt) {
            Ok(()) => self
                .repository
                .mark_delivery_receipt_submitted(&entry.receipt_id, &entry.receipt_bytes)?,
            Err(error) if error.retryable => return Err(error.to_string()),
            Err(error) => self.repository.mark_delivery_receipt_rejected(
                &entry.receipt_id,
                &entry.receipt_bytes,
                &error.code,
            )?,
        }
        Ok(true)
    }
}

fn validate_receipt(
    receipt: &DeviceConsumptionReceipt,
    receipt_id: &str,
    endpoint: &CryptoEndpoint,
) -> Result<(), String> {
    let consumer = receipt
        .consumer
        .as_ref()
        .ok_or_else(|| "messaging delivery receipt has no consumer".to_string())?;
    if receipt_id.trim().is_empty()
        || receipt.receipt_id != receipt_id
        || receipt.conversation_id.trim().is_empty()
        || receipt.event_id.trim().is_empty()
        || receipt.event_sequence <= 0
        || receipt.lane_sequence <= 0
        || receipt.payload_sha256.len() != 32
        || receipt.consumed_at.is_none()
        || consumer.ptid != endpoint.ptid
        || consumer.device_id != endpoint.device_id
    {
        return Err("messaging delivery receipt endpoint mismatch".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use prost_types::Timestamp;

    use super::*;
    use crate::proto::chat::CryptoEndpoint as ProtoCryptoEndpoint;

    struct TestRepository {
        entry: Mutex<Option<DeliveryReceiptOutboxEntry>>,
        state: Mutex<String>,
    }

    impl DeliveryReceiptRepository for TestRepository {
        fn next_delivery_receipt(&self) -> Result<Option<DeliveryReceiptOutboxEntry>, String> {
            Ok(self.entry.lock().unwrap().clone())
        }

        fn mark_delivery_receipt_submitted(
            &self,
            receipt_id: &str,
            receipt_bytes: &[u8],
        ) -> Result<(), String> {
            self.validate_transition(receipt_id, receipt_bytes)?;
            *self.state.lock().unwrap() = "submitted".to_string();
            Ok(())
        }

        fn mark_delivery_receipt_rejected(
            &self,
            receipt_id: &str,
            receipt_bytes: &[u8],
            error_code: &str,
        ) -> Result<(), String> {
            self.validate_transition(receipt_id, receipt_bytes)?;
            *self.state.lock().unwrap() = format!("rejected:{error_code}");
            Ok(())
        }
    }

    impl TestRepository {
        fn validate_transition(
            &self,
            receipt_id: &str,
            receipt_bytes: &[u8],
        ) -> Result<(), String> {
            let entry = self.entry.lock().unwrap();
            let Some(entry) = entry.as_ref() else {
                return Err("missing receipt".to_string());
            };
            if entry.receipt_id != receipt_id || entry.receipt_bytes != receipt_bytes {
                return Err("receipt transition mismatch".to_string());
            }
            Ok(())
        }
    }

    enum Outcome {
        Success,
        Retryable,
        Terminal,
    }

    struct Transport(Outcome);

    impl DeliveryReceiptTransport for Transport {
        fn submit(
            &self,
            _receipt: &DeviceConsumptionReceipt,
        ) -> Result<(), DeliveryReceiptSubmitFailure> {
            match self.0 {
                Outcome::Success => Ok(()),
                Outcome::Retryable => Err(DeliveryReceiptSubmitFailure::retryable(
                    "network", "offline",
                )),
                Outcome::Terminal => Err(DeliveryReceiptSubmitFailure::terminal(
                    "http_409", "conflict",
                )),
            }
        }
    }

    fn endpoint() -> CryptoEndpoint {
        CryptoEndpoint::new("ptid:alice", "device-1").unwrap()
    }

    fn entry() -> DeliveryReceiptOutboxEntry {
        let receipt = DeviceConsumptionReceipt {
            receipt_id: "receipt-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            event_id: "event-1".to_string(),
            event_sequence: 1,
            lane_sequence: 1,
            consumer: Some(ProtoCryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "device-1".to_string(),
            }),
            payload_sha256: vec![7; 32],
            consumed_at: Some(Timestamp {
                seconds: 1,
                nanos: 0,
            }),
        };
        DeliveryReceiptOutboxEntry {
            receipt_id: receipt.receipt_id.clone(),
            receipt_bytes: receipt.encode_to_vec(),
        }
    }

    fn repository() -> Arc<TestRepository> {
        Arc::new(TestRepository {
            entry: Mutex::new(Some(entry())),
            state: Mutex::new("pending".to_string()),
        })
    }

    #[test]
    fn success_marks_the_exact_receipt_submitted() {
        let repository = repository();
        let dispatcher = DeliveryReceiptDispatcher::new(repository.clone(), endpoint()).unwrap();

        assert!(dispatcher
            .dispatch_once(&Transport(Outcome::Success))
            .unwrap());
        assert_eq!(*repository.state.lock().unwrap(), "submitted");
    }

    #[test]
    fn terminal_failure_dead_letters_without_blocking_the_queue() {
        let repository = repository();
        let dispatcher = DeliveryReceiptDispatcher::new(repository.clone(), endpoint()).unwrap();

        assert!(dispatcher
            .dispatch_once(&Transport(Outcome::Terminal))
            .unwrap());
        assert_eq!(*repository.state.lock().unwrap(), "rejected:http_409");
    }

    #[test]
    fn retryable_failure_preserves_the_pending_receipt() {
        let repository = repository();
        let dispatcher = DeliveryReceiptDispatcher::new(repository.clone(), endpoint()).unwrap();

        assert!(dispatcher
            .dispatch_once(&Transport(Outcome::Retryable))
            .is_err());
        assert_eq!(*repository.state.lock().unwrap(), "pending");
    }
}
