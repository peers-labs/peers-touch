use super::store::{ServiceBotEventCommit, ServicePlaintextReceiveCommit};
use super::{
    verify_device_event_delivery, ClaimedItemConsumer, EngineEndpoint, MessagingStore,
    ReceiveCommitResult,
};
use crate::model::chat::{
    conversation_event, DeviceConsumptionReceipt, DeviceInboxPayloadType,
    DirectServicePlaintextPayload, DurableDeviceInboxItem, MessageDeliverySecurity,
    MessagingContentKind, PreparedEndpointPayloadKind, ServiceBotEventContent,
};
use messaging_core::inbox::{BOT_EVENT_SCHEMA, SERVICE_SYSTEM_DEVICE_ID};
use prost::Message;
use std::sync::Arc;

/// Receives non-E2EE, Station-resident direct_service_plaintext messages (bot
/// webhook events). No crypto session exists: the authority event chain,
/// delivery commitment and recipient bindings are still fully verified before
/// the readable payload lands as an ordinary direct-message projection.
pub struct ServicePlaintextProcessor {
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
    clock: fn() -> i64,
}

impl ServicePlaintextProcessor {
    pub fn new(
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err(
                "messaging service-plaintext processor requires complete endpoint".to_string(),
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
        if DeviceInboxPayloadType::try_from(item.payload_type)
            .map_err(|_| "messaging service-plaintext queue payload type is invalid".to_string())?
            != DeviceInboxPayloadType::ConversationEvent
        {
            return Err(
                "messaging service-plaintext processor received wrong queue payload type"
                    .to_string(),
            );
        }

        let delivery =
            verify_device_event_delivery(item, &self.endpoint.ptid, &self.endpoint.device_id)?;
        if PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging service-plaintext payload kind is invalid".to_string())?
            != PreparedEndpointPayloadKind::DirectServicePlaintext
        {
            return Err(
                "messaging service-plaintext processor received wrong endpoint payload kind"
                    .to_string(),
            );
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging service-plaintext delivery has no event".to_string())?;
        let message = match event.payload.as_ref() {
            Some(conversation_event::Payload::MessageCommitted(message)) => message,
            _ => {
                return Err(
                    "messaging service-plaintext delivery has unsupported event type".to_string(),
                )
            }
        };
        if MessagingContentKind::try_from(message.content_kind)
            .map_err(|_| "messaging service-plaintext content kind is invalid".to_string())?
            != MessagingContentKind::System
            || MessageDeliverySecurity::try_from(message.delivery_security)
                .map_err(|_| "messaging service-plaintext security marker is invalid".to_string())?
                != MessageDeliverySecurity::ServicePlaintext
        {
            return Err(
                "messaging service-plaintext fact must be SYSTEM/SERVICE_PLAINTEXT".to_string(),
            );
        }
        if message.message_id.trim().is_empty() {
            return Err("messaging service-plaintext fact has no message ID".to_string());
        }
        let sender = message
            .sender
            .as_ref()
            .ok_or_else(|| "messaging service-plaintext fact has no sender".to_string())?;
        if event.actor.as_ref() != Some(sender)
            || sender.ptid.trim().is_empty()
            || sender.device_id != SERVICE_SYSTEM_DEVICE_ID
        {
            return Err(
                "messaging service-plaintext sender is not the reserved system endpoint"
                    .to_string(),
            );
        }

        let payload = DirectServicePlaintextPayload::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging service-plaintext payload is invalid".to_string())?;
        if payload.fallback_text.trim().is_empty() {
            return Err("messaging service-plaintext payload requires fallback text".to_string());
        }
        let bot_content =
            if let Some(crate::model::chat::direct_service_plaintext_payload::Content::BotEvent(
                event,
            )) = payload.content
            {
                Some(event)
            } else {
                None
            };
        let bot_event = match bot_content.as_ref() {
            Some(event) => Some(build_bot_event_commit(event, &sender.ptid)?),
            None => None,
        };

        let committed_at_unix_ms = event
            .committed_at
            .as_ref()
            .map(|timestamp| {
                timestamp
                    .seconds
                    .saturating_mul(1_000)
                    .saturating_add(i64::from(timestamp.nanos) / 1_000_000)
            })
            .unwrap_or(now);

        let receipt = DeviceConsumptionReceipt {
            receipt_id: format!("device-consumed:{}", item.item_id),
            conversation_id: event.conversation_id.clone(),
            event_id: event.event_id.clone(),
            consumer: Some(crate::model::chat::CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            }),
            event_sequence: event.sequence,
            lane_sequence: item.lane_sequence,
            payload_sha256: item.payload_sha256.clone(),
            consumed_at: Some(prost_types::Timestamp {
                seconds: now.div_euclid(1_000),
                nanos: (now.rem_euclid(1_000) * 1_000_000) as i32,
            }),
        };
        let receipt_bytes = receipt.encode_to_vec();
        let result =
            self.store
                .commit_service_plaintext_receive(&ServicePlaintextReceiveCommit {
                    item_id: &item.item_id,
                    event_id: &event.event_id,
                    conversation_id: &event.conversation_id,
                    event_sequence: event.sequence,
                    lane_sequence: item.lane_sequence,
                    consumer_epoch,
                    payload_sha256: &item.payload_sha256,
                    event_hash: &event.event_hash,
                    previous_event_hash: &event.previous_hash,
                    message_id: &message.message_id,
                    sender_ptid: &sender.ptid,
                    sender_device_id: &sender.device_id,
                    fallback_text: &payload.fallback_text,
                    bot_event,
                    committed_at_unix_ms,
                    receipt_id: &receipt.receipt_id,
                    receipt_bytes: &receipt_bytes,
                    consumed_at_unix_ms: now,
                })?;
        debug_assert!(matches!(
            result,
            ReceiveCommitResult::Committed | ReceiveCommitResult::AlreadyCommitted
        ));
        Ok(())
    }
}

impl ClaimedItemConsumer for ServicePlaintextProcessor {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

/// Validates the structured bot event against the authenticated fact sender
/// and maps it into the store commit. Labels are sorted for a deterministic
/// JSON projection.
fn build_bot_event_commit<'a>(
    event: &'a ServiceBotEventContent,
    author_ptid: &'a str,
) -> Result<ServiceBotEventCommit<'a>, String> {
    if event.schema != BOT_EVENT_SCHEMA {
        return Err("messaging service-plaintext bot event schema is unsupported".to_string());
    }
    if event.bot_ptid.trim().is_empty() || event.bot_ptid != author_ptid {
        return Err("messaging service-plaintext bot event author is not bound".to_string());
    }
    let (agent, workspace, session_id) = event
        .source
        .as_ref()
        .map(|source| {
            (
                source.agent.as_str(),
                source.workspace.as_str(),
                source.session_id.as_str(),
            )
        })
        .unwrap_or(("", "", ""));
    let mut labels: Vec<(String, String)> = event
        .source
        .iter()
        .flat_map(|source| source.labels.clone())
        .collect();
    labels.sort();
    Ok(ServiceBotEventCommit {
        schema: &event.schema,
        event_type: event.event_type,
        severity: event.severity,
        bot_ptid: &event.bot_ptid,
        group_key: &event.group_key,
        dedupe_key: &event.dedupe_key,
        action_url: &event.action_url,
        source_agent: agent,
        source_workspace: workspace,
        source_session_id: session_id,
        source_labels: labels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messaging::SkippedPayloadProcessor;
    use crate::model::chat::{
        conversation_event, ConversationEvent, CryptoEndpoint as ProtoCryptoEndpoint,
        DeviceEventDelivery, DeviceInboxPayloadType, DurableDeviceInboxItem, MessageCommittedFact,
        MessageDeliverySecurity, MessagingContentKind, PreparedEndpointPayloadKind,
        ServiceBotEventKind, ServiceBotEventSeverity, ServiceBotEventSource,
    };
    use messaging_core::codec::verification::delivery_commitment_raw;
    use messaging_core::proto::actor_device_from_chat_endpoint;
    use sha2::{Digest, Sha256};

    fn now() -> i64 {
        2_000
    }

    fn owner() -> ProtoCryptoEndpoint {
        ProtoCryptoEndpoint {
            ptid: "ptid:v1:actor:peers:p:alice:aaa".to_string(),
            device_id: "alice-device".to_string(),
        }
    }

    fn bot() -> ProtoCryptoEndpoint {
        ProtoCryptoEndpoint {
            ptid: "ptid:v1:actor:peers:b:bot-wh-x:bbb".to_string(),
            device_id: SERVICE_SYSTEM_DEVICE_ID.to_string(),
        }
    }

    struct Builder {
        payload_kind: i32,
        endpoint_payload: Vec<u8>,
        content_kind: i32,
        delivery_security: i32,
        sender_device: String,
        bot_ptid: String,
        sequence: i64,
        previous_hash: Vec<u8>,
    }

    impl Builder {
        fn service(structured: bool) -> Self {
            let mut labels = std::collections::HashMap::new();
            labels.insert("repo".to_string(), "peers-touch".to_string());
            labels.insert("branch".to_string(), "feat/bot".to_string());
            let content = structured.then(|| {
                crate::model::chat::direct_service_plaintext_payload::Content::BotEvent(
                    ServiceBotEventContent {
                        schema: BOT_EVENT_SCHEMA.to_string(),
                        event_type: ServiceBotEventKind::TaskCompleted as i32,
                        severity: ServiceBotEventSeverity::Attention as i32,
                        bot_ptid: bot().ptid,
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
                )
            });
            Self {
                payload_kind: PreparedEndpointPayloadKind::DirectServicePlaintext as i32,
                endpoint_payload: DirectServicePlaintextPayload {
                    fallback_text: "任务已完成".to_string(),
                    content,
                }
                .encode_to_vec(),
                content_kind: MessagingContentKind::System as i32,
                delivery_security: MessageDeliverySecurity::ServicePlaintext as i32,
                sender_device: SERVICE_SYSTEM_DEVICE_ID.to_string(),
                bot_ptid: bot().ptid,
                sequence: 1,
                previous_hash: Vec::new(),
            }
        }

        fn unknown_kind(mut self) -> Self {
            self.payload_kind = 99;
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

        fn foreign_bot_author(mut self) -> Self {
            self.bot_ptid = "ptid:v1:actor:peers:b:other:ccc".to_string();
            self
        }

        fn build(self) -> DurableDeviceInboxItem {
            let owner = owner();
            let sender = ProtoCryptoEndpoint {
                ptid: self.bot_ptid,
                device_id: self.sender_device,
            };
            let endpoint_payload_hash = Sha256::digest(&self.endpoint_payload).to_vec();
            let mut event = ConversationEvent {
                event_id: "evt-bot-1".to_string(),
                conversation_id: "conv-bot-1".to_string(),
                sequence: self.sequence,
                command_id: "cmd-bot-1".to_string(),
                actor: Some(sender.clone()),
                previous_hash: self.previous_hash,
                event_hash: Vec::new(),
                committed_at: Some(prost_types::Timestamp {
                    seconds: 2,
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
                &owner.ptid,
                &owner.device_id,
                self.payload_kind as u32,
                &endpoint_payload_hash,
            );
            event.delivery_commitments = vec![commitment.to_vec()];
            event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
            let delivery = DeviceEventDelivery {
                event: Some(event),
                recipient: Some(owner.clone()),
                payload_kind: self.payload_kind,
                endpoint_payload: self.endpoint_payload,
                endpoint_payload_sha256: endpoint_payload_hash,
                delivery_commitment: commitment.to_vec(),
                sender_actor_identity_public_key: Vec::new(),
            };
            let opaque_payload = delivery.encode_to_vec();
            DurableDeviceInboxItem {
                item_id: "item-bot-1".to_string(),
                recipient: Some(actor_device_from_chat_endpoint(&owner)),
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

    #[test]
    fn service_plaintext_lands_as_ordinary_message_with_structured_row() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .install_test_conversation_projection("conv-bot-1", 1, 0)
            .unwrap();
        let processor = ServicePlaintextProcessor::new(
            store.clone(),
            {
                let endpoint = owner();
                EngineEndpoint {
                    ptid: endpoint.ptid,
                    device_id: endpoint.device_id,
                }
            },
            now,
        )
        .unwrap();
        let item = Builder::service(true).build();

        processor.consume(&item, 1).unwrap();

        let page = store
            .conversation_message_page("conv-bot-1", None, 10)
            .unwrap();
        assert_eq!(page.messages.len(), 1);
        let message = &page.messages[0];
        assert_eq!(message.message_id, "msg-bot-1");
        assert_eq!(message.sender_ptid, bot().ptid);
        assert_eq!(message.sender_device_id, SERVICE_SYSTEM_DEVICE_ID);
        assert_eq!(message.plaintext, "任务已完成");
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 1));
        assert_eq!(
            store.authority_head("conv-bot-1").unwrap().0,
            1,
            "authority chain must advance through the receive commit"
        );

        // The structured bot-event body is persisted for rich rendering.
        let structured: (String, i32, i32, String, String) = store
            .test_query_row(
                "SELECT event_schema, event_type, event_severity, source_agent,
                        source_labels_json
                 FROM messaging_service_messages WHERE message_id = 'msg-bot-1'",
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(structured.0, BOT_EVENT_SCHEMA);
        assert_eq!(structured.1, ServiceBotEventKind::TaskCompleted as i32);
        assert_eq!(structured.2, ServiceBotEventSeverity::Attention as i32);
        assert_eq!(structured.3, "claude-code");
        assert_eq!(
            structured.4,
            "{\"branch\":\"feat/bot\",\"repo\":\"peers-touch\"}"
        );

        // The read model used by the Desktop bot card renderer.
        let service_rows = store
            .service_messages_for_conversation("conv-bot-1")
            .unwrap();
        assert_eq!(service_rows.len(), 1);
        let row = &service_rows[0];
        assert_eq!(row.message_id, "msg-bot-1");
        assert_eq!(row.bot_ptid, bot().ptid);
        assert_eq!(row.event_schema, BOT_EVENT_SCHEMA);
        assert_eq!(row.event_type, ServiceBotEventKind::TaskCompleted as i32);
        assert_eq!(row.event_severity, ServiceBotEventSeverity::Attention as i32);
        assert_eq!(row.source_agent, "claude-code");
        assert_eq!(row.fallback_text, "任务已完成");
        assert!(store.service_messages_for_conversation("").is_err());

        // Replay is idempotent: no duplicate projection or row.
        processor.consume(&item, 1).unwrap();
        let replay = store
            .conversation_message_page("conv-bot-1", None, 10)
            .unwrap();
        assert_eq!(replay.messages.len(), 1);
    }

    #[test]
    fn service_plaintext_rejects_human_e2ee_fact() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let processor = ServicePlaintextProcessor::new(
            store.clone(),
            {
                let endpoint = owner();
                EngineEndpoint {
                    ptid: endpoint.ptid,
                    device_id: endpoint.device_id,
                }
            },
            now,
        )
        .unwrap();
        let error = processor
            .consume(&Builder::service(false).human_security().build(), 1)
            .unwrap_err();
        assert_eq!(
            error,
            "messaging service-plaintext fact must be SYSTEM/SERVICE_PLAINTEXT"
        );
    }

    #[test]
    fn service_plaintext_rejects_non_system_device_and_foreign_author() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let processor = ServicePlaintextProcessor::new(
            store.clone(),
            {
                let endpoint = owner();
                EngineEndpoint {
                    ptid: endpoint.ptid,
                    device_id: endpoint.device_id,
                }
            },
            now,
        )
        .unwrap();
        assert_eq!(
            processor
                .consume(&Builder::service(false).human_device().build(), 1)
                .unwrap_err(),
            "messaging service-plaintext sender is not the reserved system endpoint"
        );
        assert!(processor
            .consume(&Builder::service(true).foreign_bot_author().build(), 1)
            .is_err());
    }

    #[test]
    fn unknown_future_payload_kind_is_skip_acked_without_projection() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .install_test_conversation_projection("conv-bot-1", 1, 0)
            .unwrap();
        let processor = SkippedPayloadProcessor::new(
            store.clone(),
            {
                let endpoint = owner();
                EngineEndpoint {
                    ptid: endpoint.ptid,
                    device_id: endpoint.device_id,
                }
            },
            now,
        )
        .unwrap();
        let item = Builder::service(false).unknown_kind().build();

        processor.consume(&item, 1).unwrap();

        assert_eq!(store.lane_checkpoint().unwrap(), (1, 1));
        assert_eq!(
            store.authority_head("conv-bot-1").unwrap().0,
            1,
            "skipping must still advance the authority chain"
        );
        assert!(store
            .conversation_message_page("conv-bot-1", None, 10)
            .unwrap()
            .messages
            .is_empty());
        assert!(store
            .consumption_marker_matches(&item.item_id, &item.payload_sha256)
            .unwrap());
    }

    #[test]
    fn skipped_payload_fails_closed_on_tampered_delivery() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let processor = SkippedPayloadProcessor::new(
            store.clone(),
            EngineEndpoint {
                ptid: owner().ptid,
                device_id: owner().device_id,
            },
            now,
        )
        .unwrap();
        let mut item = Builder::service(false).unknown_kind().build();
        item.opaque_payload.push(0xFF);
        assert!(processor.consume(&item, 1).is_err());
        assert_eq!(store.lane_checkpoint().unwrap(), (0, 0));
    }
}
