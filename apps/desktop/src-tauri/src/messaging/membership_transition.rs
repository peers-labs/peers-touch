use super::{EngineEndpoint, MessagingStore, MlsTransitionSendCommit};
use crate::domain::mls_group::{MlsGroupManager, MlsMemberKeyPackage, MlsPreparedTransition};
use crate::infrastructure::station_client;
use crate::model::chat::{
    chat_command, ChatCommand, CryptoEndpoint, MembershipTransitionIntent,
    MessagingMembershipAction, MessagingMembershipChangeIntent,
    PrepareMessagingMembershipTransitionRequest, PrepareMessagingMembershipTransitionResponse,
    PreparedEndpointPayload, PreparedEndpointPayloadKind,
};
use prost::Message;
use reqwest::Method;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use ulid::Ulid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MembershipTransitionIntentInput {
    pub conversation_id: String,
    pub action: MessagingMembershipAction,
    pub target_ptid: String,
    pub target_device_id: String,
    pub role: String,
}

pub struct StationMembershipTransitionTransport {
    token: String,
    endpoint: EngineEndpoint,
}

impl StationMembershipTransitionTransport {
    pub fn new(token: String, endpoint: EngineEndpoint) -> Result<Self, String> {
        if token.trim().is_empty()
            || endpoint.ptid.trim().is_empty()
            || endpoint.device_id.trim().is_empty()
        {
            return Err("messaging membership transition transport is incomplete".to_string());
        }
        Ok(Self { token, endpoint })
    }

    pub fn prepare(
        &self,
        input: &MembershipTransitionIntentInput,
    ) -> Result<PrepareMessagingMembershipTransitionResponse, String> {
        station_client::request_proto_for_device::<
            PrepareMessagingMembershipTransitionRequest,
            PrepareMessagingMembershipTransitionResponse,
        >(
            Method::POST,
            "/conversation/membership/prepare",
            &self.token,
            None,
            Some(&PrepareMessagingMembershipTransitionRequest {
                conversation_id: input.conversation_id.clone(),
                sender: Some(model_endpoint(&self.endpoint)),
                action: input.action as i32,
                target_ptid: input.target_ptid.clone(),
                target_device_id: input.target_device_id.clone(),
                role: input.role.clone(),
            }),
            &self.endpoint.device_id,
        )
        .map_err(|error| error.to_string())
    }
}

pub struct MembershipTransitionPreparer {
    store: Arc<MessagingStore>,
    manager: Arc<MlsGroupManager>,
    endpoint: EngineEndpoint,
}

impl MembershipTransitionPreparer {
    pub fn new(
        store: Arc<MessagingStore>,
        manager: Arc<MlsGroupManager>,
        endpoint: EngineEndpoint,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging transition preparer requires endpoint".to_string());
        }
        Ok(Self {
            store,
            manager,
            endpoint,
        })
    }

    pub fn prepare(
        &self,
        logical_intent_id: &str,
        input: &MembershipTransitionIntentInput,
        plan: &PrepareMessagingMembershipTransitionResponse,
        created_at_unix_ms: i64,
    ) -> Result<ChatCommand, String> {
        if logical_intent_id.trim().is_empty()
            || plan.authority_plan_id.trim().is_empty()
            || plan.authority_plan_sha256.len() != 32
            || plan.authority_hash.len() != 32
            || plan.expires_at.is_none()
            || plan.from_membership_epoch <= 0
            || plan.from_mls_epoch <= 0
            || created_at_unix_ms <= 0
        {
            return Err("messaging membership transition plan is invalid".to_string());
        }
        let (local_sequence, local_hash) = self.store.authority_head(&input.conversation_id)?;
        if local_sequence != plan.authority_sequence || local_hash != plan.authority_hash {
            return Err("messaging local authority head is behind transition plan".to_string());
        }
        let member_key_packages = plan
            .reserved_key_packages
            .iter()
            .map(|reserved| {
                let target = reserved
                    .target
                    .as_ref()
                    .ok_or_else(|| "messaging reserved KeyPackage has no target".to_string())?;
                let hash = Sha256::digest(&reserved.key_package);
                if reserved.package_id.trim().is_empty()
                    || reserved.key_package.is_empty()
                    || reserved.key_package_sha256.as_slice() != hash.as_slice()
                {
                    return Err("messaging reserved KeyPackage is invalid".to_string());
                }
                Ok(MlsMemberKeyPackage {
                    ptid: target.ptid.clone(),
                    device_id: target.device_id.clone(),
                    key_package: reserved.key_package.clone(),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let prepared = self.prepare_openmls(input, &member_key_packages)?;
        if prepared.from_mls_epoch as i64 != plan.from_mls_epoch
            || prepared.to_mls_epoch as i64 != plan.from_mls_epoch + 1
        {
            self.manager
                .discard_pending_transition(&input.conversation_id);
            return Err("OpenMLS transition epoch does not match authority plan".to_string());
        }
        let affected = match input.action {
            MessagingMembershipAction::AddActor | MessagingMembershipAction::AddDevice => {
                &plan.added_endpoints
            }
            MessagingMembershipAction::RemoveActor | MessagingMembershipAction::RemoveDevice => {
                &plan.removed_endpoints
            }
            _ => {
                self.manager
                    .discard_pending_transition(&input.conversation_id);
                return Err("unsupported logical membership action".to_string());
            }
        };
        let changes = affected
            .iter()
            .map(|endpoint| MessagingMembershipChangeIntent {
                action: input.action as i32,
                ptid: endpoint.ptid.clone(),
                device_id: endpoint.device_id.clone(),
                role: input.role.clone(),
            })
            .collect::<Vec<_>>();
        let welcome_hash = Sha256::digest(&prepared.welcome_bytes).to_vec();
        let welcome_payloads = plan
            .added_endpoints
            .iter()
            .map(|endpoint| PreparedEndpointPayload {
                recipient: Some(endpoint.clone()),
                kind: PreparedEndpointPayloadKind::MlsWelcome as i32,
                opaque_payload: prepared.welcome_bytes.clone(),
                payload_sha256: welcome_hash.clone(),
            })
            .collect::<Vec<_>>();
        if (!plan.added_endpoints.is_empty() && prepared.welcome_bytes.is_empty())
            || (plan.added_endpoints.is_empty() && !prepared.welcome_bytes.is_empty())
        {
            self.manager
                .discard_pending_transition(&input.conversation_id);
            return Err("OpenMLS Welcome set does not match authority plan".to_string());
        }
        let command_id = Ulid::new().to_string();
        let command = ChatCommand {
            command_id: command_id.clone(),
            conversation_id: input.conversation_id.clone(),
            sender: Some(model_endpoint(&self.endpoint)),
            observed_membership_epoch: plan.from_membership_epoch,
            observed_mls_epoch: plan.from_mls_epoch,
            client_timestamp: Some(prost_types::Timestamp {
                seconds: created_at_unix_ms.div_euclid(1_000),
                nanos: (created_at_unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
            }),
            delivery_plan_sha256: plan.authority_plan_sha256.clone(),
            authority_station_id: plan.authority_station_id.clone(),
            payload: Some(chat_command::Payload::MembershipTransition(
                MembershipTransitionIntent {
                    transition_id: prepared.transition_id.clone(),
                    from_membership_epoch: plan.from_membership_epoch,
                    from_mls_epoch: plan.from_mls_epoch,
                    to_mls_epoch: plan.from_mls_epoch + 1,
                    changes,
                    mls_commit: prepared.commit_bytes,
                    mls_commit_sha256: prepared.commit_sha256,
                    welcome_payloads,
                    leave_intent_id: String::new(),
                    authority_plan_id: plan.authority_plan_id.clone(),
                    authority_plan_sha256: plan.authority_plan_sha256.clone(),
                },
            )),
        };
        let pending_state = self
            .manager
            .export_pending_transition(&input.conversation_id)?;
        let command_bytes = command.encode_to_vec();
        if let Err(error) = self.store.persist_mls_transition(&MlsTransitionSendCommit {
            logical_intent_id: Some(logical_intent_id),
            command_id: &command_id,
            conversation_id: &input.conversation_id,
            transition_id: &prepared.transition_id,
            delivery_plan_sha256: &plan.authority_plan_sha256,
            command_bytes: &command_bytes,
            pending_transition_state: &pending_state,
            created_at_unix_ms,
        }) {
            self.manager
                .discard_pending_transition(&input.conversation_id);
            return Err(error);
        }
        Ok(command)
    }

    fn prepare_openmls(
        &self,
        input: &MembershipTransitionIntentInput,
        key_packages: &[MlsMemberKeyPackage],
    ) -> Result<MlsPreparedTransition, String> {
        match input.action {
            MessagingMembershipAction::AddActor | MessagingMembershipAction::AddDevice => self
                .manager
                .add_members(&input.conversation_id, key_packages),
            MessagingMembershipAction::RemoveActor => self
                .manager
                .remove_member(&input.conversation_id, &input.target_ptid),
            MessagingMembershipAction::RemoveDevice => self.manager.remove_device(
                &input.conversation_id,
                &input.target_ptid,
                &input.target_device_id,
            ),
            _ => Err("unsupported logical membership action".to_string()),
        }
    }
}

fn model_endpoint(endpoint: &EngineEndpoint) -> CryptoEndpoint {
    CryptoEndpoint {
        ptid: endpoint.ptid.clone(),
        device_id: endpoint.device_id.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::mls_group::MlsGroupManager;
    use crate::messaging::PendingMembershipIntent;
    use crate::model::chat::{chat_command, ReservedMessagingMlsKeyPackage};

    #[test]
    fn add_actor_prepares_one_batch_commit_and_persists_exact_command() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .install_test_conversation_projection("group-1", 1, 1)
            .unwrap();
        store
            .install_test_authority_head("group-1", 2, &[7; 32])
            .unwrap();
        let alice = Arc::new(MlsGroupManager::new());
        let bob = MlsGroupManager::new();
        let carol_phone = MlsGroupManager::new();
        let carol_desktop = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        carol_phone
            .actor_identity()
            .init("ptid:carol", "carol-phone")
            .unwrap();
        carol_desktop
            .actor_identity()
            .init("ptid:carol", "carol-desktop")
            .unwrap();
        let genesis = alice
            .create_group(
                "group-1",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob.generate_key_package().unwrap(),
                }],
            )
            .unwrap();
        alice
            .accept_pending_transition("group-1", &genesis.transition_id)
            .unwrap();
        let carol_packages = [
            (
                "carol-desktop",
                carol_desktop.generate_key_package().unwrap(),
            ),
            ("carol-phone", carol_phone.generate_key_package().unwrap()),
        ];
        let reserved = carol_packages
            .iter()
            .map(|(device_id, bytes)| ReservedMessagingMlsKeyPackage {
                target: Some(CryptoEndpoint {
                    ptid: "ptid:carol".to_string(),
                    device_id: (*device_id).to_string(),
                }),
                package_id: format!("package-{device_id}"),
                key_package: bytes.clone(),
                key_package_sha256: Sha256::digest(bytes).to_vec(),
            })
            .collect::<Vec<_>>();
        let plan = PrepareMessagingMembershipTransitionResponse {
            authority_plan_id: "plan-add-carol".to_string(),
            expires_at: Some(prost_types::Timestamp {
                seconds: 1_800_000_000,
                nanos: 0,
            }),
            authority_station_id: "station-local".to_string(),
            authority_sequence: 2,
            authority_hash: vec![7; 32],
            from_membership_epoch: 1,
            from_mls_epoch: 1,
            pre_endpoints: vec![
                CryptoEndpoint {
                    ptid: "ptid:alice".to_string(),
                    device_id: "alice-device".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                },
            ],
            post_endpoints: vec![
                CryptoEndpoint {
                    ptid: "ptid:alice".to_string(),
                    device_id: "alice-device".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:carol".to_string(),
                    device_id: "carol-desktop".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:carol".to_string(),
                    device_id: "carol-phone".to_string(),
                },
            ],
            added_endpoints: reserved
                .iter()
                .map(|package| package.target.clone().unwrap())
                .collect(),
            removed_endpoints: Vec::new(),
            reserved_key_packages: reserved,
            endpoint_manifests: Vec::new(),
            authority_plan_sha256: vec![8; 32],
        };
        let input = MembershipTransitionIntentInput {
            conversation_id: "group-1".to_string(),
            action: MessagingMembershipAction::AddActor,
            target_ptid: "ptid:carol".to_string(),
            target_device_id: String::new(),
            role: "member".to_string(),
        };
        store
            .create_membership_intent(&PendingMembershipIntent {
                intent_id: "intent-add-carol".to_string(),
                conversation_id: "group-1".to_string(),
                action: MessagingMembershipAction::AddActor as i32,
                target_ptid: "ptid:carol".to_string(),
                target_device_id: String::new(),
                role: "member".to_string(),
                created_at_unix_ms: 100,
            })
            .unwrap();
        let command = MembershipTransitionPreparer::new(
            store.clone(),
            alice,
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
        )
        .unwrap()
        .prepare("intent-add-carol", &input, &plan, 100)
        .unwrap();
        let transition = match command.payload.as_ref().unwrap() {
            chat_command::Payload::MembershipTransition(transition) => transition,
            _ => panic!("expected membership transition"),
        };
        assert_eq!(transition.changes.len(), 2);
        assert_eq!(transition.welcome_payloads.len(), 2);
        assert_eq!(transition.authority_plan_id, "plan-add-carol");
        assert_eq!(transition.from_mls_epoch, 1);
        assert_eq!(transition.to_mls_epoch, 2);
        assert_eq!(
            store.next_command(100).unwrap().unwrap().command_bytes,
            command.encode_to_vec()
        );
        assert!(store.pending_mls_transition("group-1").unwrap().is_some());
        assert!(store.pending_membership_intents().unwrap().is_empty());
        store
            .mark_command_superseded(&command.command_id, &command.encode_to_vec(), 0)
            .unwrap();
        assert!(store.pending_mls_transition("group-1").unwrap().is_none());
        let replans = store.pending_membership_intents().unwrap();
        assert_eq!(replans.len(), 1);
        assert_eq!(replans[0].intent_id, "intent-add-carol");
        assert_eq!(replans[0].target_ptid, "ptid:carol");
    }
}
