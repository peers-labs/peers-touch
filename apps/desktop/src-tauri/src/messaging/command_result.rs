use super::{
    ClaimedItemConsumer, CommandResultDisposition, CommandResultReceiveCommit, EngineEndpoint,
    MessagingStore,
};
use crate::model::chat::{
    chat_command, ConversationCommandRejectCode, ConversationCommandResultDelivery,
    ConversationCommandSubmissionState, DeviceInboxPayloadType, DurableDeviceInboxItem,
};
use messaging_core::mls::group::MlsGroupManager;
use messaging_core::proto::actor_device_ptid;
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub struct CommandResultProcessor {
    store: Arc<MessagingStore>,
    mls_manager: Arc<MlsGroupManager>,
    endpoint: EngineEndpoint,
    clock: fn() -> i64,
}

impl CommandResultProcessor {
    pub fn new(
        store: Arc<MessagingStore>,
        mls_manager: Arc<MlsGroupManager>,
        endpoint: EngineEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err(
                "messaging command-result processor requires complete endpoint".to_string(),
            );
        }
        Ok(Self {
            store,
            mls_manager,
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
            != Some(DeviceInboxPayloadType::CommandResult)
        {
            return Err("messaging command-result queue type is invalid".to_string());
        }
        let recipient = item
            .recipient
            .as_ref()
            .ok_or_else(|| "messaging command-result recipient is missing".to_string())?;
        if actor_device_ptid(recipient)? != self.endpoint.ptid
            || recipient.device_id != self.endpoint.device_id
        {
            return Err("messaging command-result endpoint mismatch".to_string());
        }
        if item.payload_sha256.len() != 32
            || Sha256::digest(&item.opaque_payload).as_slice() != item.payload_sha256
        {
            return Err("messaging command-result payload hash mismatch".to_string());
        }

        let delivery = ConversationCommandResultDelivery::decode(item.opaque_payload.as_slice())
            .map_err(|error| format!("decode messaging command result: {error}"))?;
        let result = delivery
            .result
            .as_ref()
            .ok_or_else(|| "messaging command result payload is missing".to_string())?;
        if delivery.conversation_id != item.conversation_id
            || delivery.command_id.trim().is_empty()
            || result.command_id != delivery.command_id
        {
            return Err("messaging command result binding is invalid".to_string());
        }
        let command_bytes = self
            .store
            .command_bytes(&delivery.conversation_id, &delivery.command_id)?;
        let command = crate::model::chat::ChatCommand::decode(command_bytes.as_slice())
            .map_err(|error| format!("decode local messaging command: {error}"))?;
        if command.encode_to_vec() != command_bytes
            || command.command_id != delivery.command_id
            || command.conversation_id != delivery.conversation_id
            || command.sender.as_ref().map(|sender| sender.ptid.as_str())
                != Some(self.endpoint.ptid.as_str())
            || command
                .sender
                .as_ref()
                .map(|sender| sender.device_id.as_str())
                != Some(self.endpoint.device_id.as_str())
        {
            return Err("messaging command result does not match local command".to_string());
        }

        let state = ConversationCommandSubmissionState::try_from(delivery.state)
            .map_err(|_| "messaging command result state is invalid".to_string())?;
        let reject_code = ConversationCommandRejectCode::try_from(result.reject_code)
            .map_err(|_| "messaging command result reject code is invalid".to_string())?;
        let terminal_membership_result = state
            == ConversationCommandSubmissionState::TerminalRejected
            && matches!(
                command.payload.as_ref(),
                Some(chat_command::Payload::MembershipTransition(_))
            );
        let disposition = match state {
            ConversationCommandSubmissionState::Accepted => {
                let event = result.event.as_ref().ok_or_else(|| {
                    "messaging accepted command result has no authority event".to_string()
                })?;
                if !result.accepted
                    || result.retryable
                    || reject_code != ConversationCommandRejectCode::Unspecified
                    || item.event_id != event.event_id
                    || result.authority_sequence != event.sequence
                    || result.authority_event_hash != event.event_hash
                    || event.command_id != command.command_id
                    || event.conversation_id != command.conversation_id
                    || event.authority_station_peer_id != command.authority_station_peer_id
                    || event.actor != command.sender
                    || event.sequence <= 0
                    || event.event_hash.len() != 32
                {
                    return Err("messaging accepted command result is invalid".to_string());
                }
                CommandResultDisposition::Accepted
            }
            ConversationCommandSubmissionState::TerminalRejected => {
                if result.accepted
                    || result.retryable
                    || result.event.is_some()
                    || reject_code == ConversationCommandRejectCode::Unspecified
                    || item.event_id != hex::encode(&item.payload_sha256)
                {
                    return Err("messaging rejected command result is invalid".to_string());
                }
                let error_code = reject_code
                    .as_str_name()
                    .strip_prefix("CONVERSATION_COMMAND_REJECT_CODE_")
                    .ok_or_else(|| "messaging command reject code is invalid".to_string())?
                    .to_ascii_lowercase();
                if matches!(
                    reject_code,
                    ConversationCommandRejectCode::StaleDeliveryPlan
                        | ConversationCommandRejectCode::MembershipEpochStale
                        | ConversationCommandRejectCode::MlsEpochMismatch
                        | ConversationCommandRejectCode::AuthorityPlanStale
                        | ConversationCommandRejectCode::AuthorityPlanExpired
                ) {
                    CommandResultDisposition::Superseded(error_code)
                } else {
                    CommandResultDisposition::Failed(error_code)
                }
            }
            _ => return Err("messaging command result is not terminal".to_string()),
        };
        self.store
            .commit_command_result(&CommandResultReceiveCommit {
                item_id: &item.item_id,
                event_id: &item.event_id,
                conversation_id: &delivery.conversation_id,
                command_id: &delivery.command_id,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                disposition,
                consumed_at_unix_ms: now,
            })?;
        if terminal_membership_result {
            self.mls_manager
                .discard_pending_transition(&delivery.conversation_id);
        }
        Ok(())
    }
}

impl ClaimedItemConsumer for CommandResultProcessor {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messaging::{MlsSendCommit, PendingSenderProjection};
    use crate::model::chat::{
        chat_command, ConversationCommandProposalResult, ConversationEvent, CryptoEndpoint,
        MembershipTransitionIntent, SendMessageIntent,
    };
    use messaging_core::mls::group::MlsMemberKeyPackage;
    use messaging_core::proto::actor_device_ref;
    use messaging_core::store::{MlsTransitionRepository, MlsTransitionSendCommit};

    fn now() -> i64 {
        1_700_000_000_000
    }

    fn endpoint() -> EngineEndpoint {
        EngineEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        }
    }

    fn command(payload: chat_command::Payload) -> crate::model::chat::ChatCommand {
        crate::model::chat::ChatCommand {
            command_id: "command-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            sender: Some(CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            }),
            observed_membership_epoch: 1,
            observed_mls_epoch: 1,
            client_timestamp: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            delivery_plan_sha256: vec![7; 32],
            authority_station_peer_id: "station-four".to_string(),
            payload: Some(payload),
        }
    }

    fn prepare_message_command(
        store: &MessagingStore,
    ) -> (crate::model::chat::ChatCommand, Vec<u8>) {
        let command = command(chat_command::Payload::SendMessage(SendMessageIntent {
            message_id: "message-1".to_string(),
            ..Default::default()
        }));
        let command_bytes = command.encode_to_vec();
        let private_content =
            crate::messaging::encode_message_private_content("pending message", &[]).unwrap();
        store
            .persist_mls_send(&MlsSendCommit {
                command_bytes: &command_bytes,
                expected_authority_sequence: 0,
                expected_authority_hash: &[],
                session_state: b"local-mls-state",
                membership_epoch: 1,
                mls_epoch: 1,
                projection: PendingSenderProjection {
                    command_id: &command.command_id,
                    conversation_id: &command.conversation_id,
                    conversation_kind: 2,
                    message_id: "message-1",
                    sender_ptid: "ptid:alice",
                    sender_device_id: "alice-device",
                    plaintext: "pending message",
                    reply_to_message_id: "",
                    thread_root_message_id: "",
                    attachments: &[],
                    private_content: &private_content,
                    delivery_plan_sha256: &[7; 32],
                    created_at_unix_ms: 1_000,
                },
            })
            .unwrap();
        (command, command_bytes)
    }

    fn accepted_item(command: &crate::model::chat::ChatCommand) -> DurableDeviceInboxItem {
        let event = ConversationEvent {
            event_id: "event-1".to_string(),
            conversation_id: command.conversation_id.clone(),
            sequence: 3,
            command_id: command.command_id.clone(),
            actor: command.sender.clone(),
            event_hash: vec![9; 32],
            authority_station_peer_id: command.authority_station_peer_id.clone(),
            ..Default::default()
        };
        command_result_item(
            command,
            ConversationCommandSubmissionState::Accepted,
            ConversationCommandProposalResult {
                command_id: command.command_id.clone(),
                accepted: true,
                event: Some(event.clone()),
                authority_sequence: event.sequence,
                authority_event_hash: event.event_hash.clone(),
                ..Default::default()
            },
            event.event_id,
            1,
        )
    }

    fn terminal_item(
        command: &crate::model::chat::ChatCommand,
        reject_code: ConversationCommandRejectCode,
        lane_sequence: i64,
    ) -> DurableDeviceInboxItem {
        command_result_item(
            command,
            ConversationCommandSubmissionState::TerminalRejected,
            ConversationCommandProposalResult {
                command_id: command.command_id.clone(),
                reject_code: reject_code as i32,
                ..Default::default()
            },
            String::new(),
            lane_sequence,
        )
    }

    fn command_result_item(
        command: &crate::model::chat::ChatCommand,
        state: ConversationCommandSubmissionState,
        result: ConversationCommandProposalResult,
        event_id: String,
        lane_sequence: i64,
    ) -> DurableDeviceInboxItem {
        let delivery = ConversationCommandResultDelivery {
            conversation_id: command.conversation_id.clone(),
            command_id: command.command_id.clone(),
            state: state as i32,
            result: Some(result),
        };
        let opaque_payload = delivery.encode_to_vec();
        let payload_sha256 = Sha256::digest(&opaque_payload).to_vec();
        DurableDeviceInboxItem {
            item_id: format!("command-result-{}", hex::encode(&payload_sha256)),
            recipient: Some(actor_device_ref("ptid:alice", "alice-device")),
            lane_sequence,
            event_id: if event_id.is_empty() {
                hex::encode(&payload_sha256)
            } else {
                event_id
            },
            conversation_id: command.conversation_id.clone(),
            payload_type: DeviceInboxPayloadType::CommandResult as i32,
            opaque_payload,
            payload_sha256,
            ..Default::default()
        }
    }

    fn processor(
        store: Arc<MessagingStore>,
        mls_manager: Arc<MlsGroupManager>,
    ) -> CommandResultProcessor {
        CommandResultProcessor::new(store, mls_manager, endpoint(), now).unwrap()
    }

    #[test]
    fn accepted_result_repairs_ambiguous_local_failure() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let (command, command_bytes) = prepare_message_command(&store);
        store
            .mark_command_failed(
                &command.command_id,
                &command_bytes,
                0,
                "ambiguous_terminal_response",
            )
            .unwrap();
        let item = accepted_item(&command);

        processor(store.clone(), Arc::new(MlsGroupManager::new()))
            .consume(&item, 3)
            .unwrap();

        assert_eq!(store.lane_checkpoint().unwrap(), (1, 3));
        assert!(store
            .consumption_marker_matches(&item.item_id, &item.payload_sha256)
            .unwrap());
        assert_eq!(
            store
                .command_status(&command.command_id)
                .unwrap()
                .unwrap()
                .state,
            "committed"
        );
        assert_eq!(
            store
                .pending_sender_projection(&command.command_id)
                .unwrap()
                .unwrap()
                .1,
            "accepted"
        );
    }

    #[test]
    fn terminal_message_result_transitions_command_and_replays_exactly() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let (command, _) = prepare_message_command(&store);
        let item = terminal_item(&command, ConversationCommandRejectCode::PermissionDenied, 1);
        let result_processor = processor(store.clone(), Arc::new(MlsGroupManager::new()));

        result_processor.consume(&item, 3).unwrap();
        result_processor.consume(&item, 3).unwrap();
        let mut duplicate = item.clone();
        duplicate.item_id = "command-result-duplicate".to_string();
        duplicate.lane_sequence = 2;
        result_processor.consume(&duplicate, 4).unwrap();

        assert_eq!(store.lane_checkpoint().unwrap(), (2, 4));
        assert_eq!(
            store
                .command_status(&command.command_id)
                .unwrap()
                .unwrap()
                .state,
            "failed"
        );
        assert_eq!(
            store
                .pending_sender_projection(&command.command_id)
                .unwrap()
                .unwrap()
                .1,
            "failed"
        );
    }

    #[test]
    fn changed_replay_and_lane_gap_do_not_advance_the_cursor() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let (command, _) = prepare_message_command(&store);
        let item = terminal_item(&command, ConversationCommandRejectCode::PermissionDenied, 1);
        let result_processor = processor(store.clone(), Arc::new(MlsGroupManager::new()));
        result_processor.consume(&item, 3).unwrap();

        let mut changed = item.clone();
        changed.opaque_payload.push(0);
        changed.payload_sha256 = Sha256::digest(&changed.opaque_payload).to_vec();
        assert!(result_processor.consume(&changed, 4).is_err());
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 3));

        let second_store = Arc::new(MessagingStore::in_memory().unwrap());
        let (second_command, _) = prepare_message_command(&second_store);
        let gap = terminal_item(
            &second_command,
            ConversationCommandRejectCode::PermissionDenied,
            2,
        );
        assert!(
            processor(second_store.clone(), Arc::new(MlsGroupManager::new()))
                .consume(&gap, 3)
                .is_err()
        );
        assert_eq!(second_store.lane_checkpoint().unwrap(), (0, 0));
        assert!(!second_store
            .consumption_marker_matches(&gap.item_id, &gap.payload_sha256)
            .unwrap());
    }

    #[test]
    fn terminal_membership_result_discards_durable_and_in_memory_transition() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let mls_manager = Arc::new(MlsGroupManager::new());
        let bob = MlsGroupManager::new();
        mls_manager
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let prepared = mls_manager
            .create_group(
                "conversation-1",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob.generate_key_package().unwrap(),
                }],
            )
            .unwrap();
        let pending_state = mls_manager
            .export_pending_transition("conversation-1")
            .unwrap();
        let command = command(chat_command::Payload::MembershipTransition(
            MembershipTransitionIntent {
                transition_id: prepared.transition_id.clone(),
                ..Default::default()
            },
        ));
        let command_bytes = command.encode_to_vec();
        MlsTransitionRepository::persist_mls_transition(
            store.as_ref(),
            &MlsTransitionSendCommit {
                logical_intent_id: None,
                command_id: &command.command_id,
                conversation_id: &command.conversation_id,
                transition_id: &prepared.transition_id,
                delivery_plan_sha256: &[7; 32],
                command_bytes: &command_bytes,
                pending_transition_state: &pending_state,
                created_at_unix_ms: 1_000,
            },
        )
        .unwrap();
        let item = terminal_item(
            &command,
            ConversationCommandRejectCode::AuthorityPlanExpired,
            1,
        );

        processor(store.clone(), mls_manager.clone())
            .consume(&item, 3)
            .unwrap();

        assert!(!mls_manager.has_pending_transition("conversation-1"));
        assert!(store
            .pending_mls_transition("conversation-1")
            .unwrap()
            .is_none());
        assert_eq!(
            store
                .command_status(&command.command_id)
                .unwrap()
                .unwrap()
                .state,
            "superseded"
        );
    }
}
