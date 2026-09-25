use crate::contracts::{
    CommandResultDisposition, CommandResultReceiveCommit, CryptoEndpoint, ReceiveCommitResult,
};
use crate::inbox::ClaimedItemConsumer;
use crate::proto::actor_device_ptid;
use crate::proto::chat::{
    chat_command, ChatCommand, ConversationCommandRejectCode, ConversationCommandResultDelivery,
    ConversationCommandSubmissionState, ConversationMemberAuthorityCommand, DeviceInboxPayloadType,
    DurableDeviceInboxItem,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub trait CommandResultRepository: Send + Sync {
    fn persist_claimed_item(
        &self,
        item_id: &str,
        event_id: &str,
        conversation_id: &str,
        lane_sequence: i64,
        consumer_epoch: u64,
        payload_sha256: &[u8],
        opaque_payload: &[u8],
        now_unix_ms: i64,
    ) -> Result<(), String>;

    fn consumption_marker_matches(
        &self,
        item_id: &str,
        payload_sha256: &[u8],
    ) -> Result<bool, String>;

    fn command_bytes(&self, conversation_id: &str, command_id: &str) -> Result<Vec<u8>, String>;

    fn commit_command_result(
        &self,
        commit: &CommandResultReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String>;
}

pub trait CommandResultLifecycle: Send + Sync {
    fn discard_pending_transition(&self, conversation_id: &str, transition_id: &str);
}

impl CommandResultLifecycle for crate::mls::group::MlsGroupManager {
    fn discard_pending_transition(&self, conversation_id: &str, transition_id: &str) {
        self.discard_pending_transition_if_matches(conversation_id, transition_id);
    }
}

pub struct CommandResultProcessor<R, L> {
    store: Arc<R>,
    lifecycle: Arc<L>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: CommandResultRepository, L: CommandResultLifecycle> CommandResultProcessor<R, L> {
    pub fn new(
        store: Arc<R>,
        lifecycle: Arc<L>,
        endpoint: CryptoEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        endpoint.validate()?;
        Ok(Self {
            store,
            lifecycle,
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
        if item.item_id
            != command_result_item_id(
                &self.endpoint,
                &delivery.conversation_id,
                &delivery.command_id,
            )
        {
            return Err("messaging command result item identity is invalid".to_string());
        }
        let command_bytes = self
            .store
            .command_bytes(&delivery.conversation_id, &delivery.command_id)?;
        let (command_id, conversation_id, authority_station_id, actor, terminal_transition_id) =
            if let Ok(command) = ChatCommand::decode(command_bytes.as_slice()) {
                if command.encode_to_vec() != command_bytes {
                    return Err("messaging local command bytes are not canonical".to_string());
                }
                let terminal_transition_id = match command.payload.as_ref() {
                    Some(chat_command::Payload::MembershipTransition(transition)) => {
                        Some(transition.transition_id.clone())
                    }
                    _ => None,
                };
                (
                    command.command_id,
                    command.conversation_id,
                    command.authority_station_peer_id,
                    command.sender,
                    terminal_transition_id,
                )
            } else {
                let command = ConversationMemberAuthorityCommand::decode(command_bytes.as_slice())
                    .map_err(|error| format!("decode local member-authority command: {error}"))?;
                if command.encode_to_vec() != command_bytes {
                    return Err("messaging local command bytes are not canonical".to_string());
                }
                (
                    command.command_id,
                    command.conversation_id,
                    command.authority_station_peer_id,
                    command.operator,
                    None,
                )
            };
        if command_id != delivery.command_id
            || conversation_id != delivery.conversation_id
            || actor.as_ref().map(|actor| actor.ptid.as_str()) != Some(self.endpoint.ptid.as_str())
            || actor.as_ref().map(|actor| actor.device_id.as_str())
                != Some(self.endpoint.device_id.as_str())
        {
            return Err("messaging command result does not match local command".to_string());
        }

        let state = ConversationCommandSubmissionState::try_from(delivery.state)
            .map_err(|_| "messaging command result state is invalid".to_string())?;
        let reject_code = ConversationCommandRejectCode::try_from(result.reject_code)
            .map_err(|_| "messaging command result reject code is invalid".to_string())?;
        let terminal_transition_id = (state
            == ConversationCommandSubmissionState::TerminalRejected)
            .then_some(terminal_transition_id)
            .flatten();
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
                    || event.command_id != command_id
                    || event.conversation_id != conversation_id
                    || event.authority_station_peer_id != authority_station_id
                    || event.actor != actor
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
        if let Some(transition_id) = terminal_transition_id.as_deref() {
            self.lifecycle
                .discard_pending_transition(&delivery.conversation_id, transition_id);
        }
        Ok(())
    }
}

impl<R: CommandResultRepository, L: CommandResultLifecycle> ClaimedItemConsumer
    for CommandResultProcessor<R, L>
{
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

fn command_result_item_id(
    recipient: &CryptoEndpoint,
    conversation_id: &str,
    command_id: &str,
) -> String {
    let fields: [&[u8]; 6] = [
        b"peers-touch/conversation-command-result",
        &[1],
        recipient.ptid.as_bytes(),
        recipient.device_id.as_bytes(),
        conversation_id.as_bytes(),
        command_id.as_bytes(),
    ];
    let mut canonical = Vec::new();
    for field in fields {
        canonical.extend_from_slice(&(field.len() as u32).to_be_bytes());
        canonical.extend_from_slice(field);
    }
    hex::encode(Sha256::digest(canonical))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::actor_device_ref;
    use crate::proto::chat::{
        chat_command, ConversationCommandProposalResult, ConversationEvent,
        ConversationMemberAuthorityAction, ConversationMemberAuthorityCommand,
        CryptoEndpoint as ProtoCryptoEndpoint, MembershipTransitionIntent, ReactionIntent,
    };
    use std::sync::Mutex;

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct RecordedCommit {
        command_id: String,
        disposition: CommandResultDisposition,
        lane_sequence: i64,
        consumer_epoch: u64,
    }

    struct Repository {
        command_bytes: Vec<u8>,
        commits: Mutex<Vec<RecordedCommit>>,
    }

    impl CommandResultRepository for Repository {
        fn persist_claimed_item(
            &self,
            _item_id: &str,
            _event_id: &str,
            _conversation_id: &str,
            _lane_sequence: i64,
            _consumer_epoch: u64,
            _payload_sha256: &[u8],
            _opaque_payload: &[u8],
            _now_unix_ms: i64,
        ) -> Result<(), String> {
            Ok(())
        }

        fn consumption_marker_matches(
            &self,
            _item_id: &str,
            _payload_sha256: &[u8],
        ) -> Result<bool, String> {
            Ok(false)
        }

        fn command_bytes(
            &self,
            _conversation_id: &str,
            _command_id: &str,
        ) -> Result<Vec<u8>, String> {
            Ok(self.command_bytes.clone())
        }

        fn commit_command_result(
            &self,
            commit: &CommandResultReceiveCommit<'_>,
        ) -> Result<ReceiveCommitResult, String> {
            self.commits.lock().unwrap().push(RecordedCommit {
                command_id: commit.command_id.to_string(),
                disposition: commit.disposition.clone(),
                lane_sequence: commit.lane_sequence,
                consumer_epoch: commit.consumer_epoch,
            });
            Ok(ReceiveCommitResult::Committed)
        }
    }

    #[derive(Default)]
    struct Lifecycle {
        discarded: Mutex<Vec<(String, String)>>,
    }

    impl CommandResultLifecycle for Lifecycle {
        fn discard_pending_transition(&self, conversation_id: &str, transition_id: &str) {
            self.discarded
                .lock()
                .unwrap()
                .push((conversation_id.to_string(), transition_id.to_string()));
        }
    }

    fn command() -> ChatCommand {
        ChatCommand {
            command_id: "command-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            sender: Some(ProtoCryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            }),
            authority_station_peer_id: "station-authority".to_string(),
            payload: Some(chat_command::Payload::Reaction(ReactionIntent {
                message_id: "message-1".to_string(),
                reaction: "ack".to_string(),
                remove: false,
            })),
            ..Default::default()
        }
    }

    fn accepted_item(command: &ChatCommand) -> DurableDeviceInboxItem {
        let event_hash = vec![7; 32];
        let event = ConversationEvent {
            event_id: "event-1".to_string(),
            conversation_id: command.conversation_id.clone(),
            sequence: 3,
            command_id: command.command_id.clone(),
            actor: command.sender.clone(),
            authority_station_peer_id: command.authority_station_peer_id.clone(),
            event_hash: event_hash.clone(),
            ..Default::default()
        };
        let delivery = ConversationCommandResultDelivery {
            conversation_id: command.conversation_id.clone(),
            command_id: command.command_id.clone(),
            state: ConversationCommandSubmissionState::Accepted as i32,
            result: Some(ConversationCommandProposalResult {
                command_id: command.command_id.clone(),
                accepted: true,
                event: Some(event),
                authority_sequence: 3,
                authority_event_hash: event_hash,
                ..Default::default()
            }),
        };
        let opaque_payload = delivery.encode_to_vec();
        let payload_sha256 = Sha256::digest(&opaque_payload).to_vec();
        DurableDeviceInboxItem {
            item_id: command_result_item_id(
                &CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
                &command.conversation_id,
                &command.command_id,
            ),
            recipient: Some(actor_device_ref("ptid:alice", "alice-device")),
            lane_sequence: 4,
            event_id: "event-1".to_string(),
            conversation_id: command.conversation_id.clone(),
            payload_type: DeviceInboxPayloadType::CommandResult as i32,
            opaque_payload,
            payload_sha256,
            ..Default::default()
        }
    }

    fn rejected_item(command: &ChatCommand) -> DurableDeviceInboxItem {
        let delivery = ConversationCommandResultDelivery {
            conversation_id: command.conversation_id.clone(),
            command_id: command.command_id.clone(),
            state: ConversationCommandSubmissionState::TerminalRejected as i32,
            result: Some(ConversationCommandProposalResult {
                command_id: command.command_id.clone(),
                reject_code: ConversationCommandRejectCode::StaleDeliveryPlan as i32,
                ..Default::default()
            }),
        };
        let opaque_payload = delivery.encode_to_vec();
        let payload_sha256 = Sha256::digest(&opaque_payload).to_vec();
        DurableDeviceInboxItem {
            item_id: command_result_item_id(
                &CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
                &command.conversation_id,
                &command.command_id,
            ),
            recipient: Some(actor_device_ref("ptid:alice", "alice-device")),
            lane_sequence: 5,
            event_id: hex::encode(&payload_sha256),
            conversation_id: command.conversation_id.clone(),
            payload_type: DeviceInboxPayloadType::CommandResult as i32,
            opaque_payload,
            payload_sha256,
            ..Default::default()
        }
    }

    #[test]
    fn accepted_command_result_commits_without_replacing_event_projection() {
        let command = command();
        let repository = Arc::new(Repository {
            command_bytes: command.encode_to_vec(),
            commits: Mutex::new(Vec::new()),
        });
        let lifecycle = Arc::new(Lifecycle::default());
        let processor = CommandResultProcessor::new(
            repository.clone(),
            lifecycle.clone(),
            CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
            || 1_800_000_000_000,
        )
        .unwrap();

        processor.consume(&accepted_item(&command), 5).unwrap();

        assert_eq!(
            *repository.commits.lock().unwrap(),
            vec![RecordedCommit {
                command_id: "command-1".to_string(),
                disposition: CommandResultDisposition::Accepted,
                lane_sequence: 4,
                consumer_epoch: 5,
            }]
        );
        assert!(lifecycle.discarded.lock().unwrap().is_empty());
    }

    #[test]
    fn accepted_member_authority_result_uses_the_exact_local_command_identity() {
        let command = ConversationMemberAuthorityCommand {
            version: 1,
            command_id: "member-authority-command".to_string(),
            conversation_id: "conversation-1".to_string(),
            operator: Some(ProtoCryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            }),
            target_ptid: "ptid:bob".to_string(),
            action: ConversationMemberAuthorityAction::UpdateMember as i32,
            authority_station_peer_id: "station-authority".to_string(),
            ..Default::default()
        };
        let event_hash = vec![8; 32];
        let event = ConversationEvent {
            event_id: "member-authority-event".to_string(),
            conversation_id: command.conversation_id.clone(),
            sequence: 4,
            command_id: command.command_id.clone(),
            actor: command.operator.clone(),
            authority_station_peer_id: command.authority_station_peer_id.clone(),
            event_hash: event_hash.clone(),
            ..Default::default()
        };
        let delivery = ConversationCommandResultDelivery {
            conversation_id: command.conversation_id.clone(),
            command_id: command.command_id.clone(),
            state: ConversationCommandSubmissionState::Accepted as i32,
            result: Some(ConversationCommandProposalResult {
                command_id: command.command_id.clone(),
                accepted: true,
                event: Some(event),
                authority_sequence: 4,
                authority_event_hash: event_hash,
                ..Default::default()
            }),
        };
        let opaque_payload = delivery.encode_to_vec();
        let payload_sha256 = Sha256::digest(&opaque_payload).to_vec();
        let item = DurableDeviceInboxItem {
            item_id: command_result_item_id(
                &CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
                &command.conversation_id,
                &command.command_id,
            ),
            recipient: Some(actor_device_ref("ptid:alice", "alice-device")),
            lane_sequence: 4,
            event_id: "member-authority-event".to_string(),
            conversation_id: command.conversation_id.clone(),
            payload_type: DeviceInboxPayloadType::CommandResult as i32,
            opaque_payload,
            payload_sha256,
            ..Default::default()
        };
        let repository = Arc::new(Repository {
            command_bytes: command.encode_to_vec(),
            commits: Mutex::new(Vec::new()),
        });
        let processor = CommandResultProcessor::new(
            repository.clone(),
            Arc::new(Lifecycle::default()),
            CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
            || 20,
        )
        .unwrap();

        processor.consume(&item, 7).unwrap();

        assert_eq!(
            repository.commits.lock().unwrap().as_slice(),
            &[RecordedCommit {
                command_id: command.command_id,
                disposition: CommandResultDisposition::Accepted,
                lane_sequence: 4,
                consumer_epoch: 7,
            }]
        );
    }

    #[test]
    fn command_result_item_identity_matches_station_canonical_tuple() {
        assert_eq!(
            command_result_item_id(
                &CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
                "conversation-1",
                "command-1",
            ),
            "f436669d52b9073ba6c1851604990ede669a5e82f8ddca922d213746254e0ca5"
        );
    }

    #[test]
    fn stale_membership_result_is_superseded_and_discards_pending_transition() {
        let mut command = command();
        command.payload = Some(chat_command::Payload::MembershipTransition(
            MembershipTransitionIntent {
                transition_id: "transition-old".to_string(),
                ..Default::default()
            },
        ));
        let repository = Arc::new(Repository {
            command_bytes: command.encode_to_vec(),
            commits: Mutex::new(Vec::new()),
        });
        let lifecycle = Arc::new(Lifecycle::default());
        let processor = CommandResultProcessor::new(
            repository.clone(),
            lifecycle.clone(),
            CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
            || 1_800_000_000_000,
        )
        .unwrap();

        processor.consume(&rejected_item(&command), 6).unwrap();

        assert_eq!(
            *repository.commits.lock().unwrap(),
            vec![RecordedCommit {
                command_id: "command-1".to_string(),
                disposition: CommandResultDisposition::Superseded(
                    "stale_delivery_plan".to_string()
                ),
                lane_sequence: 5,
                consumer_epoch: 6,
            }]
        );
        assert_eq!(
            *lifecycle.discarded.lock().unwrap(),
            vec![("conversation-1".to_string(), "transition-old".to_string())]
        );
    }

    #[test]
    fn alternate_item_identity_is_rejected_before_commit() {
        let command = command();
        let repository = Arc::new(Repository {
            command_bytes: command.encode_to_vec(),
            commits: Mutex::new(Vec::new()),
        });
        let lifecycle = Arc::new(Lifecycle::default());
        let processor = CommandResultProcessor::new(
            repository.clone(),
            lifecycle,
            CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
            || 1_800_000_000_000,
        )
        .unwrap();
        let mut item = accepted_item(&command);
        item.item_id = "alternate-item-id".to_string();

        assert_eq!(
            processor.consume(&item, 5),
            Err("messaging command result item identity is invalid".to_string())
        );
        assert!(repository.commits.lock().unwrap().is_empty());
    }
}
