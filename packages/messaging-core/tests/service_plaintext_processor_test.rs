mod fixtures;

use messaging_core::codec::verification::{delivery_commitment, delivery_commitment_raw};
use messaging_core::contracts::CryptoEndpoint;
use messaging_core::inbox::{
    ClaimedItemConsumer, ServicePlaintextProcessor, SkippedPayloadProcessor, BOT_EVENT_SCHEMA,
    SERVICE_SYSTEM_DEVICE_ID,
};
use messaging_core::proto::actor_device_from_chat_endpoint;
use messaging_core::proto::chat::{
    conversation_event, ConversationEvent, CryptoEndpoint as ProtoCryptoEndpoint,
    DeviceEventDelivery, DeviceInboxPayloadType, DirectServicePlaintextPayload,
    DurableDeviceInboxItem, MessageCommittedFact, MessageDeliverySecurity, MessagingContentKind,
    PreparedEndpointPayloadKind, ServiceBotEventContent, ServiceBotEventKind,
    ServiceBotEventSeverity, ServiceBotEventSource,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
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
            fallback_text: "任务已完成".to_string(),
            content: None,
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

    fn with_bot_event(mut self) -> Self {
        let mut labels = HashMap::new();
        labels.insert("repo".to_string(), "peers-touch".to_string());
        labels.insert("branch".to_string(), "feat/bot".to_string());
        let body = DirectServicePlaintextPayload {
            fallback_text: "任务已完成".to_string(),
            content: Some(
                messaging_core::proto::chat::direct_service_plaintext_payload::Content::BotEvent(
                    ServiceBotEventContent {
                        schema: BOT_EVENT_SCHEMA.to_string(),
                        event_type: ServiceBotEventKind::TaskCompleted as i32,
                        severity: ServiceBotEventSeverity::Attention as i32,
                        bot_ptid: "ptid:v1:actor:peers:b:bot-wh_x:bbb".to_string(),
                        group_key: "task-42".to_string(),
                        dedupe_key: "evt-42".to_string(),
                        action_url: "peers://conversation/evt-42".to_string(),
                        source: Some(ServiceBotEventSource {
                            agent: "claude-code".to_string(),
                            workspace: "peers-touch".to_string(),
                            session_id: "session-7".to_string(),
                            labels,
                        }),
                    },
                ),
            ),
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
    assert_eq!(message.fallback_text, "任务已完成");
    assert!(message.bot_event.is_none());
}

#[test]
fn service_plaintext_commits_structured_bot_event() {
    let (repo, processor) = service_processor();
    let item = DeliveryBuilder::service().with_bot_event().build();

    processor.consume(&item, 1).unwrap();

    let committed = repo.committed_service.lock().unwrap();
    let message = committed
        .as_ref()
        .expect("service message must be committed");
    let event = message.bot_event.as_ref().expect("bot event projection");
    assert_eq!(event.schema, BOT_EVENT_SCHEMA);
    assert_eq!(event.event_type, ServiceBotEventKind::TaskCompleted as i32);
    assert_eq!(event.severity, ServiceBotEventSeverity::Attention as i32);
    assert_eq!(event.bot_ptid, message.sender_ptid);
    assert_eq!(event.group_key, "task-42");
    assert_eq!(event.dedupe_key, "evt-42");
    assert_eq!(event.action_url, "peers://conversation/evt-42");
    assert_eq!(event.source_agent, "claude-code");
    assert_eq!(event.source_workspace, "peers-touch");
    assert_eq!(event.source_session_id, "session-7");
    // Labels are projected in deterministic order.
    assert_eq!(
        event.source_labels,
        vec![
            ("branch".to_string(), "feat/bot".to_string()),
            ("repo".to_string(), "peers-touch".to_string()),
        ]
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
