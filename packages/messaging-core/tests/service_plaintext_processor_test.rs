mod fixtures;

use messaging_core::codec::verification::{delivery_commitment, delivery_commitment_raw};
use messaging_core::contracts::CryptoEndpoint;
use messaging_core::inbox::{
    ClaimedItemConsumer, ServicePlaintextProcessor, SkippedPayloadProcessor,
    SERVICE_SYSTEM_DEVICE_ID,
};
use messaging_core::proto::actor_device_from_chat_endpoint;
use messaging_core::proto::chat::{
    conversation_event, ConversationEvent, CryptoEndpoint as ProtoCryptoEndpoint,
    DeviceEventDelivery, DeviceInboxPayloadType, DirectServicePlaintextPayload,
    DurableDeviceInboxItem, EventSubject, MessageCommittedFact, MessageContent,
    MessageDeliverySecurity, MessageEventSeverity, MessageSourceContext, MessageTextContent,
    MessagingContentKind, PreparedEndpointPayloadKind, ReportedTaskState, StructuredEventContent,
    TaskStateUpdate,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

use fixtures::TestRepo;

fn test_clock() -> i64 {
    1_000
}

struct DeliveryBuilder {
    owner: ProtoCryptoEndpoint,
    bot: ProtoCryptoEndpoint,
    payload_kind: i32,
    endpoint_payload: Vec<u8>,
    content_kind: i32,
    delivery_security: i32,
    sender_device: String,
}

impl DeliveryBuilder {
    fn service() -> Self {
        let body = DirectServicePlaintextPayload {
            message_content: Some(MessageContent {
                primary: Some(messaging_core::proto::chat::message_content::Primary::Text(
                    MessageTextContent {
                        text: "task completed".to_string(),
                    },
                )),
                attachments: Vec::new(),
                fallback_text: "task completed".to_string(),
            }),
            source_context: None,
            source_namespace: "publisher.test".to_string(),
        };
        Self {
            owner: ProtoCryptoEndpoint {
                ptid: "ptid:v1:actor:peers:p:alice:aaa".to_string(),
                device_id: "alice-dev".to_string(),
            },
            bot: ProtoCryptoEndpoint {
                ptid: "ptid:v1:actor:peers:b:bot-wh_x:bbb".to_string(),
                device_id: SERVICE_SYSTEM_DEVICE_ID.to_string(),
            },
            payload_kind: PreparedEndpointPayloadKind::DirectServicePlaintext as i32,
            endpoint_payload: body.encode_to_vec(),
            content_kind: MessagingContentKind::System as i32,
            delivery_security: MessageDeliverySecurity::ServicePlaintext as i32,
            sender_device: SERVICE_SYSTEM_DEVICE_ID.to_string(),
        }
    }

    fn with_task_event(mut self) -> Self {
        let body = DirectServicePlaintextPayload {
            message_content: Some(MessageContent {
                primary: Some(
                    messaging_core::proto::chat::message_content::Primary::Event(
                        StructuredEventContent {
                            event_type: "agent.task.state".to_string(),
                            source_event_id: "evt-42".to_string(),
                            subject: Some(EventSubject {
                                kind: "task".to_string(),
                                id: "task-42".to_string(),
                                execution_id: "run-7".to_string(),
                            }),
                            occurred_at: None,
                            severity: MessageEventSeverity::Attention as i32,
                            title: "Task completed".to_string(),
                            body: String::new(),
                            actions: Vec::new(),
                            detail: Some(
                                messaging_core::proto::chat::structured_event_content::Detail::TaskState(
                                    TaskStateUpdate {
                                        revision: 2,
                                        state: ReportedTaskState::Completed as i32,
                                    },
                                ),
                            ),
                        },
                    ),
                ),
                attachments: Vec::new(),
                fallback_text: "Task completed".to_string(),
            }),
            source_context: Some(MessageSourceContext {
                program: "claude-code".to_string(),
                workspace: "peers-touch".to_string(),
                session_id: "session-7".to_string(),
                labels: Default::default(),
            }),
            source_namespace: "bot.test".to_string(),
        };
        self.endpoint_payload = body.encode_to_vec();
        self
    }

    fn human_security(mut self) -> Self {
        self.content_kind = MessagingContentKind::Text as i32;
        self.delivery_security = MessageDeliverySecurity::E2ee as i32;
        self
    }

    fn human_device(mut self) -> Self {
        self.sender_device = "bot-real-device".to_string();
        self
    }

    fn unknown_kind(mut self) -> Self {
        self.payload_kind = 99;
        self
    }

    fn payload_kind(mut self, kind: PreparedEndpointPayloadKind) -> Self {
        self.payload_kind = kind as i32;
        self
    }

    fn build(self) -> DurableDeviceInboxItem {
        let sender = ProtoCryptoEndpoint {
            ptid: self.bot.ptid.clone(),
            device_id: self.sender_device,
        };
        let endpoint_payload_hash = Sha256::digest(&self.endpoint_payload).to_vec();

        let mut event = ConversationEvent {
            event_id: "evt-bot-1".to_string(),
            conversation_id: "conv-bot-1".to_string(),
            sequence: 1,
            command_id: "cmd-bot-1".to_string(),
            actor: Some(sender.clone()),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 0,
            authority_station_peer_id: "station-1".to_string(),
            payload: Some(conversation_event::Payload::MessageCommitted(
                MessageCommittedFact {
                    message_id: "msg-bot-1".to_string(),
                    sender: Some(sender),
                    content_kind: self.content_kind,
                    reply_to_message_id: String::new(),
                    thread_root_message_id: String::new(),
                    attachments: Vec::new(),
                    client_timestamp: None,
                    delivery_security: self.delivery_security,
                },
            )),
        };
        let commitment = delivery_commitment_raw(
            "conv-bot-1",
            "evt-bot-1",
            &self.owner.ptid,
            &self.owner.device_id,
            self.payload_kind as u32,
            &endpoint_payload_hash,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();

        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(self.owner.clone()),
            payload_kind: self.payload_kind,
            endpoint_payload: self.endpoint_payload,
            endpoint_payload_sha256: endpoint_payload_hash,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: Vec::new(),
        };
        let opaque_payload = delivery.encode_to_vec();
        DurableDeviceInboxItem {
            item_id: "item-bot-1".to_string(),
            recipient: Some(actor_device_from_chat_endpoint(&self.owner)),
            lane_sequence: 1,
            event_id: "evt-bot-1".to_string(),
            conversation_id: "conv-bot-1".to_string(),
            idempotency_key: "event:evt-bot-1".to_string(),
            payload_type: DeviceInboxPayloadType::ConversationEvent as i32,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }
}

fn service_processor() -> (Arc<TestRepo>, ServicePlaintextProcessor<TestRepo>) {
    let repo = Arc::new(TestRepo::without_session());
    let processor = ServicePlaintextProcessor::new(
        repo.clone(),
        CryptoEndpoint {
            ptid: "ptid:v1:actor:peers:p:alice:aaa".to_string(),
            device_id: "alice-dev".to_string(),
        },
        test_clock,
    )
    .unwrap();
    (repo, processor)
}

#[test]
fn service_plaintext_commits_fallback_as_ordinary_message() {
    let (repo, processor) = service_processor();
    let item = DeliveryBuilder::service().build();

    processor.consume(&item, 1).unwrap();

    let committed = repo.committed_service.lock().unwrap();
    let message = committed
        .as_ref()
        .expect("service message must be committed");
    assert_eq!(message.message_id, "msg-bot-1");
    assert_eq!(message.conversation_id, "conv-bot-1");
    assert_eq!(message.event_id, "evt-bot-1");
    assert_eq!(message.event_sequence, 1);
    assert_eq!(message.sender_ptid, "ptid:v1:actor:peers:b:bot-wh_x:bbb");
    assert_eq!(message.sender_device_id, SERVICE_SYSTEM_DEVICE_ID);
    assert_eq!(message.fallback_text, "task completed");
    assert_eq!(message.source_namespace, "publisher.test");
}

#[test]
fn service_plaintext_commits_structured_task_event() {
    let (repo, processor) = service_processor();
    let item = DeliveryBuilder::service().with_task_event().build();

    processor.consume(&item, 1).unwrap();

    let committed = repo.committed_service.lock().unwrap();
    let message = committed
        .as_ref()
        .expect("service message must be committed");
    assert_eq!(message.source_namespace, "bot.test");
    let event = match message.content.primary.as_ref().expect("primary") {
        messaging_core::proto::chat::message_content::Primary::Event(event) => event,
        _ => panic!("expected structured event"),
    };
    assert_eq!(event.event_type, "agent.task.state");
    assert_eq!(event.subject.as_ref().unwrap().execution_id, "run-7");
    assert_eq!(
        message.source_context.as_ref().unwrap().program,
        "claude-code"
    );
}

#[test]
fn service_plaintext_rejects_human_e2ee_fact() {
    let (_repo, processor) = service_processor();
    let item = DeliveryBuilder::service().human_security().build();

    let error = processor.consume(&item, 1).unwrap_err();
    assert_eq!(
        error,
        "messaging service-plaintext fact must be SYSTEM/SERVICE_PLAINTEXT"
    );
}

#[test]
fn service_plaintext_rejects_non_system_sender_device() {
    let (_repo, processor) = service_processor();
    let item = DeliveryBuilder::service().human_device().build();

    let error = processor.consume(&item, 1).unwrap_err();
    assert_eq!(
        error,
        "messaging service-plaintext sender is not the reserved system endpoint"
    );
}

#[test]
fn service_plaintext_decoder_rejects_every_mls_group_delivery_kind() {
    for kind in [
        PreparedEndpointPayloadKind::MlsApplication,
        PreparedEndpointPayloadKind::MlsCommit,
        PreparedEndpointPayloadKind::MlsWelcome,
        PreparedEndpointPayloadKind::MlsRetirement,
    ] {
        let (repo, processor) = service_processor();
        let item = DeliveryBuilder::service().payload_kind(kind).build();

        let error = processor.consume(&item, 1).unwrap_err();
        assert_eq!(
            error,
            "messaging service-plaintext processor received wrong endpoint payload kind"
        );
        assert!(repo.committed_service.lock().unwrap().is_none());
        assert!(repo.committed_message.lock().unwrap().is_none());
    }
}

#[test]
fn normal_direct_ciphertext_never_enters_service_plaintext_decoder() {
    let (repo, processor) = service_processor();
    let item = DeliveryBuilder::service()
        .payload_kind(PreparedEndpointPayloadKind::DirectCiphertext)
        .build();

    let error = processor.consume(&item, 1).unwrap_err();
    assert_eq!(
        error,
        "messaging service-plaintext processor received wrong endpoint payload kind"
    );
    assert!(repo.committed_service.lock().unwrap().is_none());
    assert!(repo.committed_message.lock().unwrap().is_none());
}

#[test]
fn unknown_future_payload_kind_is_skip_acked_without_projection() {
    let repo = Arc::new(TestRepo::without_session());
    let processor = SkippedPayloadProcessor::new(
        repo.clone(),
        CryptoEndpoint {
            ptid: "ptid:v1:actor:peers:p:alice:aaa".to_string(),
            device_id: "alice-dev".to_string(),
        },
        test_clock,
    )
    .unwrap();
    let item = DeliveryBuilder::service().unknown_kind().build();

    processor.consume(&item, 1).unwrap();

    let skipped = repo.skipped_payloads.lock().unwrap();
    assert_eq!(*skipped, vec!["item-bot-1".to_string()]);
    assert!(repo.committed_service.lock().unwrap().is_none());
    assert!(repo.committed_message.lock().unwrap().is_none());
    // The raw commitment helper must agree with the typed helper on known kinds.
    let payload_hash = Sha256::digest(b"x");
    let typed = delivery_commitment(
        "conv-bot-1",
        "evt-bot-1",
        "ptid:v1:actor:peers:p:alice:aaa",
        "alice-dev",
        PreparedEndpointPayloadKind::DirectServicePlaintext,
        &payload_hash,
    );
    let raw = delivery_commitment_raw(
        "conv-bot-1",
        "evt-bot-1",
        "ptid:v1:actor:peers:p:alice:aaa",
        "alice-dev",
        PreparedEndpointPayloadKind::DirectServicePlaintext as u32,
        &payload_hash,
    );
    assert_eq!(typed, raw);
}

#[test]
fn skipped_payload_fails_closed_on_tampered_delivery() {
    let repo = Arc::new(TestRepo::without_session());
    let processor = SkippedPayloadProcessor::new(
        repo.clone(),
        CryptoEndpoint {
            ptid: "ptid:v1:actor:peers:p:alice:aaa".to_string(),
            device_id: "alice-dev".to_string(),
        },
        test_clock,
    )
    .unwrap();
    let mut item = DeliveryBuilder::service().unknown_kind().build();
    item.opaque_payload.push(0xFF);

    assert!(processor.consume(&item, 1).is_err());
    assert!(repo.skipped_payloads.lock().unwrap().is_empty());
}
