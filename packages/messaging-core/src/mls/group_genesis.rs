use super::group::{MlsGroupManager, MlsMemberKeyPackage};
use crate::proto::chat::{
    chat_command, ChatCommand, CryptoEndpoint, MembershipTransitionIntent,
    MessagingMembershipAction, MessagingMembershipChangeIntent,
    PrepareMessagingGroupGenesisResponse, PreparedEndpointPayload, PreparedEndpointPayloadKind,
};
use crate::store::{MlsTransitionRepository, MlsTransitionSendCommit};
use prost::Message;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::Arc;
use ulid::Ulid;

pub struct GroupGenesisPreparer<R> {
    store: Arc<R>,
    manager: Arc<MlsGroupManager>,
    endpoint: CryptoEndpoint,
}

impl<R: MlsTransitionRepository> GroupGenesisPreparer<R> {
    pub fn new(
        store: Arc<R>,
        manager: Arc<MlsGroupManager>,
        endpoint: CryptoEndpoint,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging group genesis preparer requires endpoint".to_string());
        }
        Ok(Self {
            store,
            manager,
            endpoint,
        })
    }

    pub fn prepare(
        &self,
        plan: &PrepareMessagingGroupGenesisResponse,
        conversation_id: &str,
        created_at_unix_ms: i64,
    ) -> Result<ChatCommand, String> {
        if plan.authority_plan_id.trim().is_empty()
            || plan.authority_station_id.trim().is_empty()
            || plan.authority_plan_sha256.len() != 32
            || plan.expires_at.is_none()
            || conversation_id.trim().is_empty()
            || created_at_unix_ms <= 0
        {
            return Err("messaging group genesis plan is invalid".to_string());
        }

        let expected_members = plan
            .prospective_endpoints
            .iter()
            .filter(|endpoint| **endpoint != self.endpoint)
            .cloned()
            .collect::<Vec<_>>();
        let member_key_packages = validated_key_packages(&plan.reserved_key_packages)?;
        let package_endpoints = member_key_packages
            .iter()
            .map(|member| (member.ptid.as_str(), member.device_id.as_str()))
            .collect::<HashSet<_>>();
        if expected_members.len() != member_key_packages.len()
            || expected_members.iter().any(|endpoint| {
                !package_endpoints.contains(&(endpoint.ptid.as_str(), endpoint.device_id.as_str()))
            })
        {
            return Err("messaging group genesis KeyPackage set mismatch".to_string());
        }

        let prepared = self
            .manager
            .create_group(conversation_id, &member_key_packages)?;
        let command_id = Ulid::new().to_string();
        let mut seen_actors = HashSet::new();
        let changes = plan
            .prospective_endpoints
            .iter()
            .map(|endpoint| {
                let first_device = seen_actors.insert(endpoint.ptid.clone());
                MessagingMembershipChangeIntent {
                    action: if first_device {
                        MessagingMembershipAction::AddActor as i32
                    } else {
                        MessagingMembershipAction::AddDevice as i32
                    },
                    ptid: endpoint.ptid.clone(),
                    device_id: endpoint.device_id.clone(),
                    role: if endpoint.ptid == self.endpoint.ptid {
                        "owner".to_string()
                    } else {
                        "member".to_string()
                    },
                }
            })
            .collect::<Vec<_>>();
        let welcome_hash = Sha256::digest(&prepared.welcome_bytes).to_vec();
        let welcome_payloads = expected_members
            .iter()
            .map(|endpoint| PreparedEndpointPayload {
                recipient: Some(endpoint.clone()),
                kind: PreparedEndpointPayloadKind::MlsWelcome as i32,
                opaque_payload: prepared.welcome_bytes.clone(),
                payload_sha256: welcome_hash.clone(),
            })
            .collect::<Vec<_>>();
        let command = ChatCommand {
            command_id: command_id.clone(),
            conversation_id: conversation_id.to_string(),
            sender: Some(self.endpoint.clone()),
            observed_membership_epoch: 0,
            observed_mls_epoch: 0,
            client_timestamp: Some(prost_types::Timestamp {
                seconds: created_at_unix_ms.div_euclid(1_000),
                nanos: (created_at_unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
            }),
            delivery_plan_sha256: plan.authority_plan_sha256.clone(),
            authority_station_id: plan.authority_station_id.clone(),
            payload: Some(chat_command::Payload::MembershipTransition(
                MembershipTransitionIntent {
                    transition_id: prepared.transition_id.clone(),
                    from_membership_epoch: 0,
                    from_mls_epoch: 0,
                    to_mls_epoch: 1,
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
        let pending_state = self.manager.export_pending_transition(conversation_id)?;
        let command_bytes = command.encode_to_vec();
        if let Err(error) = self.store.persist_mls_transition(&MlsTransitionSendCommit {
            logical_intent_id: None,
            command_id: &command_id,
            conversation_id,
            transition_id: &prepared.transition_id,
            delivery_plan_sha256: &plan.authority_plan_sha256,
            command_bytes: &command_bytes,
            pending_transition_state: &pending_state,
            created_at_unix_ms,
        }) {
            self.manager.discard_pending_transition(conversation_id);
            return Err(error);
        }
        Ok(command)
    }
}

fn validated_key_packages(
    reserved_key_packages: &[crate::proto::chat::ReservedMessagingMlsKeyPackage],
) -> Result<Vec<MlsMemberKeyPackage>, String> {
    reserved_key_packages
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
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mls::test_support::TestTransitionRepository;
    use crate::proto::chat::ReservedMessagingMlsKeyPackage;

    #[test]
    fn genesis_persists_exact_command_and_pending_openmls_state() {
        let store = Arc::new(TestTransitionRepository::new(1, vec![7; 32]));
        let alice = Arc::new(MlsGroupManager::new());
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let bob_key_package = bob.generate_key_package().unwrap();
        let plan = PrepareMessagingGroupGenesisResponse {
            authority_plan_id: "plan-1".to_string(),
            expires_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            authority_station_id: "station-local".to_string(),
            prospective_endpoints: vec![
                CryptoEndpoint {
                    ptid: "ptid:alice".to_string(),
                    device_id: "alice-device".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                },
            ],
            reserved_key_packages: vec![ReservedMessagingMlsKeyPackage {
                target: Some(CryptoEndpoint {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                }),
                package_id: "package-1".to_string(),
                key_package_sha256: Sha256::digest(&bob_key_package).to_vec(),
                key_package: bob_key_package,
            }],
            endpoint_manifests: Vec::new(),
            authority_plan_sha256: vec![8; 32],
        };

        let command =
            GroupGenesisPreparer::new(store.clone(), alice, plan.prospective_endpoints[0].clone())
                .unwrap()
                .prepare(&plan, "group-1", 100)
                .unwrap();

        let transition = match command.payload.as_ref().unwrap() {
            chat_command::Payload::MembershipTransition(transition) => transition,
            _ => panic!("expected membership transition"),
        };
        assert_eq!(transition.from_membership_epoch, 0);
        assert_eq!(transition.to_mls_epoch, 1);
        assert_eq!(transition.welcome_payloads.len(), 1);
        assert_eq!(
            transition.welcome_payloads[0].recipient,
            Some(plan.prospective_endpoints[1].clone())
        );
        let persisted = store.transition().unwrap();
        assert_eq!(persisted.logical_intent_id, None);
        assert_eq!(persisted.transition_id, transition.transition_id);
        assert_eq!(persisted.command_bytes, command.encode_to_vec());
        assert!(!persisted.pending_transition_state.is_empty());
    }
}
