use std::sync::Arc;

use prost::Message;

use crate::contracts::CryptoEndpoint;
use crate::proto::chat::{MessageReceipt, ReceiptType};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryReceiptOutboxEntry {
    pub receipt_id: String,
    pub receipt_bytes: Vec<u8>,
}

pub trait DeliveryReceiptRepository: Send + Sync {
    fn next_delivery_receipt(&self) -> Result<Option<DeliveryReceiptOutboxEntry>, String>;

    fn mark_delivery_receipt_submitted(
        &self,
        receipt_id: &str,
        receipt_bytes: &[u8],
    ) -> Result<(), String>;
}

pub trait DeliveryReceiptTransport: Send + Sync {
    fn submit(&self, receipt: &MessageReceipt) -> Result<(), String>;
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
        let receipt = MessageReceipt::decode(entry.receipt_bytes.as_slice())
            .map_err(|error| format!("decode messaging delivery receipt: {error}"))?;
        if receipt.receipt_type != ReceiptType::Delivered as i32
            || receipt.ptid != self.endpoint.ptid
            || receipt.device_id != self.endpoint.device_id
        {
            return Err("messaging delivery receipt endpoint mismatch".to_string());
        }
        transport.submit(&receipt)?;
        self.repository
            .mark_delivery_receipt_submitted(&entry.receipt_id, &entry.receipt_bytes)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    struct TestRepository {
        entry: Mutex<Option<DeliveryReceiptOutboxEntry>>,
        submitted: Mutex<bool>,
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
            let entry = self.entry.lock().unwrap();
            let Some(entry) = entry.as_ref() else {
                return Err("missing receipt".to_string());
            };
            if entry.receipt_id != receipt_id || entry.receipt_bytes != receipt_bytes {
                return Err("receipt transition mismatch".to_string());
            }
            *self.submitted.lock().unwrap() = true;
            Ok(())
        }
    }

    #[derive(Default)]
    struct RecordingTransport {
        receipts: Mutex<Vec<MessageReceipt>>,
    }

    impl DeliveryReceiptTransport for RecordingTransport {
        fn submit(&self, receipt: &MessageReceipt) -> Result<(), String> {
            self.receipts.lock().unwrap().push(receipt.clone());
            Ok(())
        }
    }

    fn endpoint() -> CryptoEndpoint {
        CryptoEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "device-1".to_string(),
        }
    }

    fn entry(receipt_type: ReceiptType, device_id: &str) -> DeliveryReceiptOutboxEntry {
        let receipt = MessageReceipt {
            conversation_id: "conversation-1".to_string(),
            message_id: "message-1".to_string(),
            ptid: "ptid:alice".to_string(),
            device_id: device_id.to_string(),
            receipt_type: receipt_type as i32,
            ts: None,
        };
        DeliveryReceiptOutboxEntry {
            receipt_id: "receipt-1".to_string(),
            receipt_bytes: receipt.encode_to_vec(),
        }
    }

    #[test]
    fn dispatch_marks_the_exact_receipt_after_transport_success() {
        let repository = Arc::new(TestRepository {
            entry: Mutex::new(Some(entry(ReceiptType::Delivered, "device-1"))),
            submitted: Mutex::new(false),
        });
        let transport = RecordingTransport::default();
        let dispatcher = DeliveryReceiptDispatcher::new(repository.clone(), endpoint()).unwrap();

        assert!(dispatcher.dispatch_once(&transport).unwrap());
        assert!(*repository.submitted.lock().unwrap());
        assert_eq!(transport.receipts.lock().unwrap().len(), 1);
    }

    #[test]
    fn dispatch_rejects_non_delivery_or_cross_device_receipts() {
        for receipt in [
            entry(ReceiptType::Read, "device-1"),
            entry(ReceiptType::Delivered, "device-2"),
        ] {
            let repository = Arc::new(TestRepository {
                entry: Mutex::new(Some(receipt)),
                submitted: Mutex::new(false),
            });
            let dispatcher =
                DeliveryReceiptDispatcher::new(repository.clone(), endpoint()).unwrap();
            assert!(dispatcher
                .dispatch_once(&RecordingTransport::default())
                .is_err());
            assert!(!*repository.submitted.lock().unwrap());
        }
    }
}
