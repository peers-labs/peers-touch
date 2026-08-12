use super::{DirectReceiveCommit, MessagingStore, ReceiveCommitResult};
use std::sync::Mutex;

pub trait QueueAcknowledger {
    fn acknowledge(
        &self,
        item_id: &str,
        lane_sequence: i64,
        consumer_epoch: u64,
        payload_sha256: &[u8],
    ) -> Result<(), String>;
}

pub struct InboxWorker<A> {
    store: MessagingStore,
    acknowledger: A,
    drain: Mutex<()>,
}

impl<A: QueueAcknowledger> InboxWorker<A> {
    pub fn new(store: MessagingStore, acknowledger: A) -> Self {
        Self {
            store,
            acknowledger,
            drain: Mutex::new(()),
        }
    }

    pub fn commit_and_ack(
        &self,
        input: &DirectReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String> {
        let _drain = self
            .drain
            .lock()
            .map_err(|_| "messaging inbox drain lock poisoned".to_string())?;
        let result = self.store.commit_direct_receive(input)?;
        self.acknowledger.acknowledge(
            input.item_id,
            input.lane_sequence,
            input.consumer_epoch,
            input.payload_sha256,
        )?;
        Ok(result)
    }

    pub fn store(&self) -> &MessagingStore {
        &self.store
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::crypto::double_ratchet::DrSessionState;
    use crate::domain::crypto::{CryptoEndpoint, DirectSession, DirectSessionKey};
    use crate::messaging::MessageProjection;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct AckSpy {
        calls: AtomicUsize,
    }

    impl QueueAcknowledger for AckSpy {
        fn acknowledge(
            &self,
            _item_id: &str,
            _lane_sequence: i64,
            _consumer_epoch: u64,
            _payload_sha256: &[u8],
        ) -> Result<(), String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    fn session() -> DirectSession {
        DirectSession {
            session_id: "session-1".to_string(),
            key: DirectSessionKey::new(
                "conversation-1",
                CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
                CryptoEndpoint::new("ptid:bob", "bob-device").unwrap(),
                1,
            )
            .unwrap(),
            protocol_version: 1,
            established: true,
            peer_identity_key: [1; 32],
            ratchet: DrSessionState {
                session_id: "session-1".to_string(),
                root_key: [2; 32],
                self_priv: [3; 32],
                self_pub: [4; 32],
                peer_pub: Some([5; 32]),
                send_chain_key: Some([6; 32]),
                recv_chain_key: Some([7; 32]),
                n_send: 0,
                n_recv: 1,
                n_prev: 0,
            },
            updated_at_unix_ms: 100,
        }
    }

    #[test]
    fn ack_happens_only_after_durable_commit_and_replay_reacks() {
        let store = MessagingStore::in_memory().unwrap();
        let payload_hash = [8_u8; 32];
        store
            .persist_claimed_item(
                "item-1",
                "event-1",
                "conversation-1",
                1,
                1,
                &payload_hash,
                b"delivery",
                90,
            )
            .unwrap();
        let projection = MessageProjection {
            conversation_id: "conversation-1".to_string(),
            event_id: "event-1".to_string(),
            event_sequence: 1,
            message_id: "message-1".to_string(),
            sender_ptid: "ptid:bob".to_string(),
            sender_device_id: "bob-device".to_string(),
            plaintext: "exact plaintext".to_string(),
            attachments: Vec::new(),
            committed_at_unix_ms: 100,
            reply_to_message_id: None,
            edited_text: None,
            edited_at_unix_ms: None,
            retracted: false,
        };
        let session = session();
        let input = DirectReceiveCommit {
            item_id: "item-1",
            event_id: "event-1",
            conversation_id: "conversation-1",
            lane_sequence: 1,
            consumer_epoch: 1,
            payload_sha256: &payload_hash,
            event_hash: &[11; 32],
            previous_event_hash: &[],
            session: &session,
            new_skipped: &[],
            consumed_skipped: None,
            consumed_one_time_prekey_id: None,
            projection: &projection,
            reply_to_message_id: None,
            receipt_id: "receipt-1",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 100,
        };
        let worker = InboxWorker::new(store, AckSpy::default());
        assert_eq!(
            worker.commit_and_ack(&input).unwrap(),
            ReceiveCommitResult::Committed
        );
        assert_eq!(worker.acknowledger.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            worker.commit_and_ack(&input).unwrap(),
            ReceiveCommitResult::AlreadyCommitted
        );
        assert_eq!(worker.acknowledger.calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn failed_local_transaction_never_acks() {
        let store = MessagingStore::in_memory().unwrap();
        let payload_hash = [8_u8; 32];
        store
            .persist_claimed_item(
                "item-2",
                "event-2",
                "conversation-1",
                2,
                1,
                &payload_hash,
                b"delivery",
                90,
            )
            .unwrap();
        let projection = MessageProjection {
            conversation_id: "conversation-1".to_string(),
            event_id: "event-2".to_string(),
            event_sequence: 2,
            message_id: "message-2".to_string(),
            sender_ptid: "ptid:bob".to_string(),
            sender_device_id: "bob-device".to_string(),
            plaintext: "must not persist".to_string(),
            attachments: Vec::new(),
            committed_at_unix_ms: 100,
            reply_to_message_id: None,
            edited_text: None,
            edited_at_unix_ms: None,
            retracted: false,
        };
        let session = session();
        let input = DirectReceiveCommit {
            item_id: "item-2",
            event_id: "event-2",
            conversation_id: "conversation-1",
            lane_sequence: 2,
            consumer_epoch: 1,
            payload_sha256: &payload_hash,
            event_hash: &[12; 32],
            previous_event_hash: &[11; 32],
            session: &session,
            new_skipped: &[],
            consumed_skipped: None,
            consumed_one_time_prekey_id: None,
            projection: &projection,
            reply_to_message_id: None,
            receipt_id: "receipt-2",
            receipt_bytes: b"receipt",
            consumed_at_unix_ms: 100,
        };
        let worker = InboxWorker::new(store, AckSpy::default());
        assert!(worker.commit_and_ack(&input).is_err());
        assert_eq!(worker.acknowledger.calls.load(Ordering::SeqCst), 0);
    }
}
