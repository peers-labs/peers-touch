use super::group::{MlsGroupManager, MlsMemberKeyPackage, MlsPreparedTransition};
use super::leave_intent::validate_signed_leave_intent;
use crate::proto::chat::{
    chat_command, ChatCommand, CryptoEndpoint, MembershipTransitionIntent,
    MessagingMembershipAction, MessagingMembershipChangeIntent, MlsLeaveIntent,
    PrepareConversationMembershipResponse, PreparedEndpointPayload, PreparedEndpointPayloadKind,
};
use crate::proto::key_exchange::MlsKeyPackageReservation;
use crate::proto::{actor_device_ptid, chat_endpoint};
use crate::store::{MlsTransitionRepository, MlsTransitionSendCommit};
use prost::Message;
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
    pub leave_intent: Option<MlsLeaveIntent>,
}

pub struct MembershipTransitionPreparer<R> {
    store: Arc<R>,
    manager: Arc<MlsGroupManager>,
    endpoint: CryptoEndpoint,
}

impl<R: MlsTransitionRepository> MembershipTransitionPreparer<R> {
    pub fn new(
        store: Arc<R>,
        manager: Arc<MlsGroupManager>,
        endpoint: CryptoEndpoint,
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
        logical_intent_id: Option<&str>,
        input: &MembershipTransitionIntentInput,
        plan: &PrepareConversationMembershipResponse,
        created_at_unix_ms: i64,
    ) -> Result<ChatCommand, String> {
        validate_plan(logical_intent_id, plan, created_at_unix_ms)?;
        let (local_sequence, local_hash) = self.store.authority_head(&input.conversation_id)?;
        if local_sequence != plan.authority_sequence || local_hash != plan.authority_hash {
            return Err("messaging local authority head is behind transition plan".to_string());
        }
        let leave_intent_id = validate_leave_binding(input, plan)?;

        let key_packages = validated_key_packages(&plan.reserved_key_packages)?;
        let prepared = self.prepare_openmls(input, &key_packages)?;
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
            MessagingMembershipAction::Leave => &plan.removed_endpoints,
            _ => {
                self.manager
                    .discard_pending_transition(&input.conversation_id);
                return Err("unsupported logical membership action".to_string());
            }
        };
        let changes = affected
            .iter()
            .enumerate()
            .filter_map(|(index, endpoint)| {
                let action = match input.action {
                    MessagingMembershipAction::AddActor if index > 0 => {
                        MessagingMembershipAction::AddDevice
                    }
                    MessagingMembershipAction::RemoveActor | MessagingMembershipAction::Leave
                        if index > 0 =>
                    {
                        return None;
                    }
                    action => action,
                };
                Some((action, endpoint))
            })
            .map(|(action, endpoint)| {
                Ok(MessagingMembershipChangeIntent {
                    action: action as i32,
                    ptid: actor_device_ptid(endpoint)?.to_string(),
                    device_id: endpoint.device_id.clone(),
                    role: input.role.clone(),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let welcome_hash = Sha256::digest(&prepared.welcome_bytes).to_vec();
        let welcome_payloads = plan
            .added_endpoints
            .iter()
            .map(|endpoint| {
                Ok(PreparedEndpointPayload {
                    recipient: Some(chat_endpoint(endpoint)?),
                    kind: PreparedEndpointPayloadKind::MlsWelcome as i32,
                    opaque_payload: prepared.welcome_bytes.clone(),
                    payload_sha256: welcome_hash.clone(),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
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
            sender: Some(self.endpoint.clone()),
            observed_membership_epoch: plan.from_membership_epoch,
            observed_mls_epoch: plan.from_mls_epoch,
            client_timestamp: Some(prost_types::Timestamp {
                seconds: created_at_unix_ms.div_euclid(1_000),
                nanos: (created_at_unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
            }),
            delivery_plan_sha256: plan.authority_plan_sha256.clone(),
            authority_station_peer_id: plan.authority_station_peer_id.clone(),
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
                    leave_intent_id,
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
            logical_intent_id,
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
            MessagingMembershipAction::Leave => self
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

fn validate_leave_binding(
    input: &MembershipTransitionIntentInput,
    plan: &PrepareConversationMembershipResponse,
) -> Result<String, String> {
    if input.action != MessagingMembershipAction::Leave {
        if input.leave_intent.is_some() {
            return Err("non-leave membership transition carries a leave intent".to_string());
        }
        return Ok(String::new());
    }
    let intent = input
        .leave_intent
        .as_ref()
        .ok_or_else(|| "delegated leave requires a signed leave intent".to_string())?;
    validate_signed_leave_intent(intent)?;
    let target_pre_endpoints = plan
        .pre_endpoints
        .iter()
        .map(|endpoint| Ok((actor_device_ptid(endpoint)?, endpoint)))
        .collect::<Result<Vec<_>, String>>()?
        .into_iter()
        .filter_map(|(ptid, endpoint)| (ptid == input.target_ptid).then_some(endpoint))
        .collect::<Vec<_>>();
    let removed_endpoints = plan
        .removed_endpoints
        .iter()
        .map(|endpoint| Ok((actor_device_ptid(endpoint)?, endpoint.device_id.as_str())))
        .collect::<Result<Vec<_>, String>>()?;
    let post_endpoint_ptids = plan
        .post_endpoints
        .iter()
        .map(actor_device_ptid)
        .collect::<Result<Vec<_>, String>>()?;
    if intent.conversation_id != input.conversation_id
        || intent.actor_ptid != input.target_ptid
        || intent.observed_membership_epoch != plan.from_membership_epoch
        || intent.observed_mls_epoch != plan.from_mls_epoch
        || !input.target_device_id.is_empty()
        || target_pre_endpoints.is_empty()
        || target_pre_endpoints.len() != removed_endpoints.len()
        || removed_endpoints
            .iter()
            .any(|(ptid, _)| *ptid != input.target_ptid)
        || target_pre_endpoints.iter().any(|expected| {
            let expected_ptid = actor_device_ptid(expected).ok();
            !removed_endpoints
                .iter()
                .any(|(removed_ptid, removed_device_id)| {
                    Some(*removed_ptid) == expected_ptid
                        && *removed_device_id == expected.device_id.as_str()
                })
        })
        || post_endpoint_ptids
            .iter()
            .any(|ptid| *ptid == input.target_ptid)
    {
        return Err("delegated leave intent does not match transition plan".to_string());
    }
    Ok(intent.intent_id.clone())
}

fn validate_plan(
    logical_intent_id: Option<&str>,
    plan: &PrepareConversationMembershipResponse,
    created_at_unix_ms: i64,
) -> Result<(), String> {
    if logical_intent_id.is_some_and(|intent_id| intent_id.trim().is_empty())
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
    Ok(())
}

fn validated_key_packages(
    reserved_key_packages: &[MlsKeyPackageReservation],
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
                ptid: actor_device_ptid(target)?.to_string(),
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
    use crate::proto::actor_device_ref;
    use crate::store::{MlsTransitionRepository, MlsTransitionSendCommit};

    fn leave_intent(conversation_id: &str, target_ptid: &str) -> MlsLeaveIntent {
        MlsLeaveIntent {
            version: 1,
            intent_id: "leave-intent-1".to_string(),
            federation_id: "federation-1".to_string(),
            authority_station_peer_id: "station-local".to_string(),
            authority_epoch: 1,
            home_station_peer_id: "station-home".to_string(),
            conversation_id: conversation_id.to_string(),
            actor_ptid: target_ptid.to_string(),
            actor_device_id: "bob-device".to_string(),
            actor_signing_key_id: "sha256:key".to_string(),
            observed_membership_epoch: 1,
            observed_mls_epoch: 1,
            created_at_unix_ms: 100,
            expires_at_unix_ms: 300_100,
            actor_signature: vec![1],
            authority_sequence: 1,
            authority_hash: vec![7; 32],
        }
    }

    fn leave_plan() -> PrepareConversationMembershipResponse {
        PrepareConversationMembershipResponse {
            authority_plan_id: "plan-leave-bob".to_string(),
            expires_at: Some(prost_types::Timestamp {
                seconds: 1_800_000_000,
                nanos: 0,
            }),
            authority_station_peer_id: "station-local".to_string(),
            authority_sequence: 2,
            authority_hash: vec![7; 32],
            from_membership_epoch: 1,
            from_mls_epoch: 1,
            pre_endpoints: vec![
                actor_device_ref("ptid:alice", "alice-device"),
                actor_device_ref("ptid:bob", "bob-device"),
            ],
            post_endpoints: vec![actor_device_ref("ptid:alice", "alice-device")],
            added_endpoints: Vec::new(),
            removed_endpoints: vec![actor_device_ref("ptid:bob", "bob-device")],
            reserved_key_packages: Vec::new(),
            endpoint_manifests: Vec::new(),
            authority_plan_sha256: vec![8; 32],
        }
    }

    fn leave_group() -> Arc<MlsGroupManager> {
        let alice = Arc::new(MlsGroupManager::new());
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let genesis = alice
            .create_group(
                "group-leave",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob.generate_key_package().unwrap(),
                }],
            )
            .unwrap();
        alice
            .accept_pending_transition("group-leave", &genesis.transition_id)
            .unwrap();
        alice
    }

    #[test]
    fn add_actor_prepares_one_batch_commit_and_persists_exact_command() {
        let store = Arc::new(TestTransitionRepository::new(2, vec![7; 32]));
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
        let reserved_key_packages = carol_packages
            .iter()
            .map(|(device_id, key_package)| MlsKeyPackageReservation {
                target: Some(actor_device_ref("ptid:carol", *device_id)),
                package_id: format!("package-{device_id}"),
                key_package_sha256: Sha256::digest(key_package).to_vec(),
                key_package: key_package.clone(),
            })
            .collect::<Vec<_>>();
        let plan = PrepareConversationMembershipResponse {
            authority_plan_id: "plan-add-carol".to_string(),
            expires_at: Some(prost_types::Timestamp {
                seconds: 1_800_000_000,
                nanos: 0,
            }),
            authority_station_peer_id: "station-local".to_string(),
            authority_sequence: 2,
            authority_hash: vec![7; 32],
            from_membership_epoch: 1,
            from_mls_epoch: 1,
            pre_endpoints: vec![
                actor_device_ref("ptid:alice", "alice-device"),
                actor_device_ref("ptid:bob", "bob-device"),
            ],
            post_endpoints: Vec::new(),
            added_endpoints: reserved_key_packages
                .iter()
                .map(|package| package.target.clone().unwrap())
                .collect(),
            removed_endpoints: Vec::new(),
            reserved_key_packages,
            endpoint_manifests: Vec::new(),
            authority_plan_sha256: vec![8; 32],
        };
        let input = MembershipTransitionIntentInput {
            conversation_id: "group-1".to_string(),
            action: MessagingMembershipAction::AddActor,
            target_ptid: "ptid:carol".to_string(),
            target_device_id: String::new(),
            role: "member".to_string(),
            leave_intent: None,
        };

        let command = MembershipTransitionPreparer::new(
            store.clone(),
            alice,
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
        )
        .unwrap()
        .prepare(Some("intent-add-carol"), &input, &plan, 100)
        .unwrap();

        let transition = match command.payload.as_ref().unwrap() {
            chat_command::Payload::MembershipTransition(transition) => transition,
            _ => panic!("expected membership transition"),
        };
        assert_eq!(transition.changes.len(), 2);
        assert_eq!(
            transition.changes[0].action,
            MessagingMembershipAction::AddActor as i32
        );
        assert_eq!(
            transition.changes[1].action,
            MessagingMembershipAction::AddDevice as i32
        );
        assert_eq!(transition.welcome_payloads.len(), 2);
        assert_eq!(transition.authority_plan_id, "plan-add-carol");
        assert_eq!(transition.from_mls_epoch, 1);
        assert_eq!(transition.to_mls_epoch, 2);
        let persisted = store.transition().unwrap();
        assert_eq!(
            persisted.logical_intent_id.as_deref(),
            Some("intent-add-carol")
        );
        assert_eq!(persisted.transition_id, transition.transition_id);
        assert_eq!(persisted.command_bytes, command.encode_to_vec());
        assert!(!persisted.pending_transition_state.is_empty());
    }

    #[test]
    fn delegated_leave_emits_leave_changes_and_exact_intent_id() {
        let store = Arc::new(TestTransitionRepository::new(2, vec![7; 32]));
        let manager = leave_group();
        let input = MembershipTransitionIntentInput {
            conversation_id: "group-leave".to_string(),
            action: MessagingMembershipAction::Leave,
            target_ptid: "ptid:bob".to_string(),
            target_device_id: String::new(),
            role: String::new(),
            leave_intent: Some(leave_intent("group-leave", "ptid:bob")),
        };

        let command = MembershipTransitionPreparer::new(
            store,
            manager,
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
        )
        .unwrap()
        .prepare(None, &input, &leave_plan(), 100)
        .unwrap();
        let transition = match command.payload.unwrap() {
            chat_command::Payload::MembershipTransition(transition) => transition,
            _ => panic!("expected membership transition"),
        };

        assert_eq!(transition.leave_intent_id, "leave-intent-1");
        assert_eq!(transition.changes.len(), 1);
        assert_eq!(
            transition.changes[0].action,
            MessagingMembershipAction::Leave as i32
        );
        assert_eq!(transition.changes[0].ptid, "ptid:bob");
        assert_eq!(transition.changes[0].device_id, "bob-device");
    }

    #[test]
    fn delegated_leave_rejects_invalid_binding_before_openmls_changes() {
        let manager = leave_group();
        let base_input = MembershipTransitionIntentInput {
            conversation_id: "group-leave".to_string(),
            action: MessagingMembershipAction::Leave,
            target_ptid: "ptid:bob".to_string(),
            target_device_id: String::new(),
            role: String::new(),
            leave_intent: Some(leave_intent("group-leave", "ptid:bob")),
        };
        let mut invalid_inputs = Vec::new();
        let mut wrong_conversation = base_input.clone();
        wrong_conversation
            .leave_intent
            .as_mut()
            .unwrap()
            .conversation_id = "another-group".to_string();
        let invalid_for_prepare = wrong_conversation.clone();
        invalid_inputs.push(wrong_conversation);
        let mut wrong_actor = base_input.clone();
        wrong_actor.leave_intent.as_mut().unwrap().actor_ptid = "ptid:carol".to_string();
        invalid_inputs.push(wrong_actor);
        let mut wrong_membership_epoch = base_input.clone();
        wrong_membership_epoch
            .leave_intent
            .as_mut()
            .unwrap()
            .observed_membership_epoch = 2;
        invalid_inputs.push(wrong_membership_epoch);
        let mut wrong_mls_epoch = base_input.clone();
        wrong_mls_epoch
            .leave_intent
            .as_mut()
            .unwrap()
            .observed_mls_epoch = 2;
        invalid_inputs.push(wrong_mls_epoch);
        let mut empty_intent_id = base_input.clone();
        empty_intent_id
            .leave_intent
            .as_mut()
            .unwrap()
            .intent_id
            .clear();
        invalid_inputs.push(empty_intent_id);
        let mut device_scoped_leave = base_input;
        device_scoped_leave.target_device_id = "bob-device".to_string();
        invalid_inputs.push(device_scoped_leave);

        for input in invalid_inputs {
            assert!(validate_leave_binding(&input, &leave_plan()).is_err());
        }

        let error = MembershipTransitionPreparer::new(
            Arc::new(TestTransitionRepository::new(2, vec![7; 32])),
            manager.clone(),
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
        )
        .unwrap()
        .prepare(None, &invalid_for_prepare, &leave_plan(), 100)
        .unwrap_err();

        assert!(error.contains("does not match"));
        assert!(!manager.has_pending_transition("group-leave"));
        assert_eq!(manager.group_epoch("group-leave").unwrap(), 1);
    }

    #[test]
    fn remove_actor_preserves_non_delegated_semantics() {
        let store = Arc::new(TestTransitionRepository::new(2, vec![7; 32]));
        let input = MembershipTransitionIntentInput {
            conversation_id: "group-leave".to_string(),
            action: MessagingMembershipAction::RemoveActor,
            target_ptid: "ptid:bob".to_string(),
            target_device_id: String::new(),
            role: String::new(),
            leave_intent: None,
        };

        let command = MembershipTransitionPreparer::new(
            store,
            leave_group(),
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
        )
        .unwrap()
        .prepare(Some("remove-bob"), &input, &leave_plan(), 100)
        .unwrap();
        let transition = match command.payload.unwrap() {
            chat_command::Payload::MembershipTransition(transition) => transition,
            _ => panic!("expected membership transition"),
        };

        assert!(transition.leave_intent_id.is_empty());
        assert_eq!(
            transition.changes[0].action,
            MessagingMembershipAction::RemoveActor as i32
        );
    }

    struct FailingTransitionRepository;

    impl MlsTransitionRepository for FailingTransitionRepository {
        fn authority_head(&self, _conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
            Ok((2, vec![7; 32]))
        }

        fn persist_mls_transition(
            &self,
            _commit: &MlsTransitionSendCommit<'_>,
        ) -> Result<(), String> {
            Err("injected transition persistence failure".to_string())
        }
    }

    #[test]
    fn persistence_failure_discards_prepared_leave_before_live_state_changes() {
        let manager = leave_group();
        let before = manager.public_head("group-leave").unwrap();
        let input = MembershipTransitionIntentInput {
            conversation_id: "group-leave".to_string(),
            action: MessagingMembershipAction::Leave,
            target_ptid: "ptid:bob".to_string(),
            target_device_id: String::new(),
            role: String::new(),
            leave_intent: Some(leave_intent("group-leave", "ptid:bob")),
        };

        let error = MembershipTransitionPreparer::new(
            Arc::new(FailingTransitionRepository),
            manager.clone(),
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
        )
        .unwrap()
        .prepare(None, &input, &leave_plan(), 100)
        .unwrap_err();

        assert!(error.contains("injected"));
        assert!(!manager.has_pending_transition("group-leave"));
        assert_eq!(
            manager.public_head("group-leave").unwrap().mls_epoch,
            before.mls_epoch
        );
        let members = |head: crate::mls::group::MlsPublicHead| {
            head.members
                .into_iter()
                .map(|member| (member.ptid, member.device_id))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            members(manager.public_head("group-leave").unwrap()),
            members(before)
        );
    }
}
