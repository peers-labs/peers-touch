use std::sync::Arc;

use prost::Message;

use crate::proto::chat::{
    chat_command, ChatCommand, CryptoEndpoint, PinMessageIntent,
    PrepareConversationCommandResponse, ReactionIntent, RetractMessageIntent,
};
use crate::proto::crypto_endpoints_from_actor_device_refs;

pub enum MetadataInteraction<'a> {
    Retract,
    Reaction { reaction: &'a str, remove: bool },
    Pin { remove: bool },
}

pub struct MetadataInteractionCommit<'a> {
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub target_message_id: &'a str,
    pub interaction_kind: &'a str,
    pub command_bytes: &'a [u8],
    pub delivery_plan_sha256: &'a [u8],
    pub expected_authority_sequence: i64,
    pub expected_authority_hash: &'a [u8],
    pub created_at_unix_ms: i64,
}

pub trait MetadataInteractionRepository: Send + Sync {
    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String>;

    fn message_sender(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> Result<Option<String>, String>;

    fn persist_metadata_interaction(
        &self,
        commit: &MetadataInteractionCommit<'_>,
    ) -> Result<(), String>;
}

pub struct MetadataInteractionPreparer<R> {
    repository: Arc<R>,
    endpoint: CryptoEndpoint,
}

impl<R: MetadataInteractionRepository> MetadataInteractionPreparer<R> {
    pub fn new(repository: Arc<R>, endpoint: CryptoEndpoint) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging interaction preparer requires endpoint".to_string());
        }
        Ok(Self {
            repository,
            endpoint,
        })
    }

    pub fn prepare(
        &self,
        plan: &PrepareConversationCommandResponse,
        command_id: &str,
        message_id: &str,
        interaction: MetadataInteraction<'_>,
        now_unix_ms: i64,
    ) -> Result<ChatCommand, String> {
        if command_id.trim().is_empty()
            || message_id.trim().is_empty()
            || now_unix_ms <= 0
            || plan.conversation_id.trim().is_empty()
            || plan.authority_station_peer_id.trim().is_empty()
            || plan.delivery_plan_sha256.len() != 32
            || plan.membership_epoch < 0
            || plan.mls_epoch < 0
            || plan.authority_sequence < 0
            || (plan.authority_sequence == 0 && !plan.authority_hash.is_empty())
            || (plan.authority_sequence > 0 && plan.authority_hash.len() != 32)
        {
            return Err("messaging interaction context is incomplete".to_string());
        }
        let required_endpoints = crypto_endpoints_from_actor_device_refs(&plan.required_endpoints)
            .ok_or_else(|| "messaging interaction plan has incomplete endpoint".to_string())?;
        let mut previous_endpoint: Option<(&str, &str)> = None;
        let mut local_endpoint_count = 0;
        for endpoint in &required_endpoints {
            let endpoint_key = (endpoint.ptid.as_str(), endpoint.device_id.as_str());
            if previous_endpoint.is_some_and(|previous| previous >= endpoint_key) {
                return Err(
                    "messaging interaction plan endpoints are not strictly sorted".to_string(),
                );
            }
            previous_endpoint = Some(endpoint_key);
            if endpoint == &self.endpoint {
                local_endpoint_count += 1;
            }
        }
        if local_endpoint_count != 1 {
            return Err(
                "messaging interaction plan does not contain the sending endpoint".to_string(),
            );
        }
        let sender = self
            .repository
            .message_sender(&plan.conversation_id, message_id)?
            .ok_or_else(|| "messaging interaction target projection is unavailable".to_string())?;
        if matches!(interaction, MetadataInteraction::Retract) && sender != self.endpoint.ptid {
            return Err("messaging retract target is not authored by this actor".to_string());
        }
        let authority = self.repository.authority_head(&plan.conversation_id)?;
        if authority != (plan.authority_sequence, plan.authority_hash.clone()) {
            return Err("messaging local authority head is behind interaction plan".to_string());
        }
        let (payload, interaction_kind) = match interaction {
            MetadataInteraction::Retract => (
                chat_command::Payload::RetractMessage(RetractMessageIntent {
                    message_id: message_id.to_string(),
                }),
                "retract",
            ),
            MetadataInteraction::Reaction { reaction, remove } => {
                if reaction.trim().is_empty() {
                    return Err("messaging reaction value is required".to_string());
                }
                (
                    chat_command::Payload::Reaction(ReactionIntent {
                        message_id: message_id.to_string(),
                        reaction: reaction.to_string(),
                        remove,
                    }),
                    if remove {
                        "reaction-remove"
                    } else {
                        "reaction-add"
                    },
                )
            }
            MetadataInteraction::Pin { remove } => (
                chat_command::Payload::PinMessage(PinMessageIntent {
                    message_id: message_id.to_string(),
                    remove,
                }),
                if remove { "unpin" } else { "pin" },
            ),
        };
        let command = ChatCommand {
            command_id: command_id.to_string(),
            conversation_id: plan.conversation_id.clone(),
            sender: Some(self.endpoint.clone()),
            observed_membership_epoch: plan.membership_epoch,
            observed_mls_epoch: plan.mls_epoch,
            client_timestamp: Some(prost_types::Timestamp {
                seconds: now_unix_ms.div_euclid(1_000),
                nanos: (now_unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
            }),
            delivery_plan_sha256: plan.delivery_plan_sha256.clone(),
            authority_station_id: plan.authority_station_peer_id.clone(),
            payload: Some(payload),
        };
        self.repository
            .persist_metadata_interaction(&MetadataInteractionCommit {
                command_id,
                conversation_id: &plan.conversation_id,
                target_message_id: message_id,
                interaction_kind,
                command_bytes: &command.encode_to_vec(),
                delivery_plan_sha256: &plan.delivery_plan_sha256,
                expected_authority_sequence: plan.authority_sequence,
                expected_authority_hash: &plan.authority_hash,
                created_at_unix_ms: now_unix_ms,
            })?;
        Ok(command)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::proto::chat::chat_command;

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct PersistedInteraction {
        command_id: String,
        conversation_id: String,
        target_message_id: String,
        interaction_kind: String,
        command_bytes: Vec<u8>,
        delivery_plan_sha256: Vec<u8>,
        expected_authority_sequence: i64,
        expected_authority_hash: Vec<u8>,
        created_at_unix_ms: i64,
    }

    struct TestRepository {
        authority_head: (i64, Vec<u8>),
        message_sender: Option<String>,
        persisted: Mutex<Vec<PersistedInteraction>>,
    }

    impl MetadataInteractionRepository for TestRepository {
        fn authority_head(&self, _conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
            Ok(self.authority_head.clone())
        }

        fn message_sender(
            &self,
            _conversation_id: &str,
            _message_id: &str,
        ) -> Result<Option<String>, String> {
            Ok(self.message_sender.clone())
        }

        fn persist_metadata_interaction(
            &self,
            commit: &MetadataInteractionCommit<'_>,
        ) -> Result<(), String> {
            self.persisted.lock().unwrap().push(PersistedInteraction {
                command_id: commit.command_id.to_string(),
                conversation_id: commit.conversation_id.to_string(),
                target_message_id: commit.target_message_id.to_string(),
                interaction_kind: commit.interaction_kind.to_string(),
                command_bytes: commit.command_bytes.to_vec(),
                delivery_plan_sha256: commit.delivery_plan_sha256.to_vec(),
                expected_authority_sequence: commit.expected_authority_sequence,
                expected_authority_hash: commit.expected_authority_hash.to_vec(),
                created_at_unix_ms: commit.created_at_unix_ms,
            });
            Ok(())
        }
    }

    fn plan() -> PrepareConversationCommandResponse {
        PrepareConversationCommandResponse {
            conversation_id: "conversation-1".to_string(),
            authority_sequence: 7,
            authority_hash: vec![8; 32],
            membership_epoch: 3,
            mls_epoch: 2,
            delivery_plan_sha256: vec![9; 32],
            authority_station_peer_id: "station-authority".to_string(),
            required_endpoints: vec![
                crate::proto::actor_device_ref_from_parts("ptid:alice", "alice-device"),
                crate::proto::actor_device_ref_from_parts("ptid:bob", "bob-device"),
            ],
            ..Default::default()
        }
    }

    fn preparer(
        sender: &str,
        authority_head: (i64, Vec<u8>),
    ) -> (
        Arc<TestRepository>,
        MetadataInteractionPreparer<TestRepository>,
    ) {
        let repository = Arc::new(TestRepository {
            authority_head,
            message_sender: Some(sender.to_string()),
            persisted: Mutex::new(Vec::new()),
        });
        let preparer = MetadataInteractionPreparer::new(
            repository.clone(),
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
        )
        .unwrap();
        (repository, preparer)
    }

    #[test]
    fn metadata_interaction_persists_exact_reaction_command() {
        let (repository, preparer) = preparer("ptid:bob", (7, vec![8; 32]));
        let command = preparer
            .prepare(
                &plan(),
                "command-1",
                "message-1",
                MetadataInteraction::Reaction {
                    reaction: "thumbs-up",
                    remove: false,
                },
                1_234,
            )
            .unwrap();

        let reaction = match command.payload.as_ref().unwrap() {
            chat_command::Payload::Reaction(reaction) => reaction,
            _ => panic!("unexpected metadata interaction payload"),
        };
        assert_eq!(reaction.message_id, "message-1");
        assert_eq!(reaction.reaction, "thumbs-up");
        assert!(!reaction.remove);

        let persisted = repository.persisted.lock().unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].interaction_kind, "reaction-add");
        assert_eq!(persisted[0].command_bytes, command.encode_to_vec());
        assert_eq!(persisted[0].delivery_plan_sha256, vec![9; 32]);
        assert_eq!(persisted[0].expected_authority_sequence, 7);
        assert_eq!(persisted[0].expected_authority_hash, vec![8; 32]);
    }

    #[test]
    fn metadata_interaction_rejects_unauthorized_or_stale_intent_without_persistence() {
        let (repository, unauthorized_preparer) = preparer("ptid:bob", (7, vec![8; 32]));
        assert_eq!(
            unauthorized_preparer
                .prepare(
                    &plan(),
                    "command-1",
                    "message-1",
                    MetadataInteraction::Retract,
                    1_234,
                )
                .unwrap_err(),
            "messaging retract target is not authored by this actor"
        );
        assert!(repository.persisted.lock().unwrap().is_empty());

        let (repository, stale_preparer) = preparer("ptid:alice", (6, vec![7; 32]));
        assert_eq!(
            stale_preparer
                .prepare(
                    &plan(),
                    "command-2",
                    "message-1",
                    MetadataInteraction::Pin { remove: false },
                    1_235,
                )
                .unwrap_err(),
            "messaging local authority head is behind interaction plan"
        );
        assert!(repository.persisted.lock().unwrap().is_empty());
    }
}
