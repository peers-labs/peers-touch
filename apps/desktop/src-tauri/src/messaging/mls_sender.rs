use super::{
    verify_device_event_delivery, ClaimedItemConsumer, EngineEndpoint, MessagingStore,
    MlsSenderTransitionReceiveCommit, ReceiveCommitResult,
};
use crate::domain::mls_group::MlsGroupManager;
use crate::model::chat::{
    conversation_event, CryptoEndpoint, DeviceConsumptionReceipt, DeviceQueueItem,
    PreparedEndpointPayloadKind, PublicEventMarker,
};
use prost::Message;
use std::sync::Arc;

pub struct MlsSenderTransitionProcessor {
    manager: Arc<MlsGroupManager>,
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
    clock: fn() -> i64,
}

impl MlsSenderTransitionProcessor {
    pub fn new(
        manager: Arc<MlsGroupManager>,
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging MLS sender processor requires endpoint".to_string());
        }
        Ok(Self {
            manager,
            store,
            endpoint,
            clock,
        })
    }

    fn process(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
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
            if let Some(state) = self.store.load_mls_session_state(&item.conversation_id)? {
                self.manager
                    .import_session_state(&item.conversation_id, &state)?;
            }
            return Ok(());
        }
        let delivery =
            verify_device_event_delivery(item, &self.endpoint.ptid, &self.endpoint.device_id)?;
        if PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging MLS sender marker kind is invalid".to_string())?
            != PreparedEndpointPayloadKind::PublicEvent
        {
            return Err("messaging MLS sender received wrong payload kind".to_string());
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging MLS sender event is missing".to_string())?;
        let transition = match event.payload.as_ref() {
            Some(conversation_event::Payload::MembershipTransitionCommitted(transition)) => {
                transition
            }
            _ => return Err("messaging MLS sender transition fact is missing".to_string()),
        };
        let marker = PublicEventMarker::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging MLS sender marker is invalid".to_string())?;
        if marker.conversation_id != event.conversation_id
            || marker.event_id != event.event_id
            || marker.command_id != event.command_id
            || marker.sending_endpoint.as_ref() != Some(&model_endpoint(&self.endpoint))
        {
            return Err("messaging MLS sender marker binding mismatch".to_string());
        }
        let pending = self
            .store
            .pending_mls_transition(&event.conversation_id)?
            .ok_or_else(|| "messaging MLS sender pending transition is unavailable".to_string())?;
        if pending.transition_id != transition.transition_id
            || pending.command_id != event.command_id
        {
            return Err("messaging MLS sender pending transition mismatch".to_string());
        }
        let prepared_manager = MlsGroupManager::with_actor_identity(self.manager.actor_identity());
        prepared_manager.import_pending_transition(&event.conversation_id, &pending.state)?;
        prepared_manager
            .accept_pending_transition(&event.conversation_id, &transition.transition_id)?;
        let session_state = prepared_manager.export_session_state(&event.conversation_id)?;
        let receipt = DeviceConsumptionReceipt {
            receipt_id: format!("device-consumed:{}", item.item_id),
            conversation_id: event.conversation_id.clone(),
            event_id: event.event_id.clone(),
            consumer: Some(model_endpoint(&self.endpoint)),
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
                .commit_mls_sender_transition(&MlsSenderTransitionReceiveCommit {
                    item_id: &item.item_id,
                    event_id: &event.event_id,
                    conversation_id: &event.conversation_id,
                    command_id: &event.command_id,
                    transition_id: &transition.transition_id,
                    event_sequence: event.sequence,
                    lane_sequence: item.lane_sequence,
                    consumer_epoch,
                    payload_sha256: &item.payload_sha256,
                    event_hash: &event.event_hash,
                    previous_event_hash: &event.previous_hash,
                    session_state: &session_state,
                    membership_epoch: event.membership_epoch,
                    mls_epoch: event.mls_epoch,
                    receipt_id: &receipt.receipt_id,
                    receipt_bytes: &receipt_bytes,
                    consumed_at_unix_ms: now,
                })?;
        if result == ReceiveCommitResult::Committed {
            self.manager
                .import_session_state(&event.conversation_id, &session_state)?;
            self.manager
                .discard_pending_transition(&event.conversation_id);
        }
        Ok(())
    }
}

impl ClaimedItemConsumer for MlsSenderTransitionProcessor {
    fn consume(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
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
    use super::super::verification::delivery_commitment;
    use super::*;
    use crate::domain::mls_group::MlsGroupManager;
    use crate::messaging::GroupGenesisPreparer;
    use crate::model::chat::{
        chat_command, ConversationEvent, DeviceEventDelivery, DeviceQueuePayloadType,
        MembershipTransitionCommittedFact, MessagingMembershipChangeCommitted,
        PrepareMessagingGroupGenesisResponse, ReservedMessagingMlsKeyPackage,
    };
    use sha2::{Digest, Sha256};

    fn now() -> i64 {
        200
    }

    #[test]
    fn sender_marker_commits_prepared_genesis_before_installing_live_session() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .install_test_conversation_projection("group-1", 0, 0)
            .unwrap();
        store
            .install_test_authority_head("group-1", 1, &[7; 32])
            .unwrap();
        let alice = Arc::new(MlsGroupManager::new());
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let endpoint = EngineEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };
        let bob_key_package = bob.generate_key_package().unwrap();
        let bob_key_package_sha256 = Sha256::digest(&bob_key_package).to_vec();
        let plan = PrepareMessagingGroupGenesisResponse {
            authority_plan_id: "plan-1".to_string(),
            expires_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            authority_station_id: "station-local".to_string(),
            prospective_endpoints: vec![
                model_endpoint(&endpoint),
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
                key_package: bob_key_package,
                key_package_sha256: bob_key_package_sha256,
            }],
            endpoint_manifests: Vec::new(),
            authority_plan_sha256: vec![8; 32],
        };
        let command = GroupGenesisPreparer::new(store.clone(), alice.clone(), endpoint.clone())
            .unwrap()
            .prepare(&plan, "group-1", 100)
            .unwrap();
        let transition = match command.payload.as_ref().unwrap() {
            chat_command::Payload::MembershipTransition(transition) => transition,
            _ => panic!("expected transition"),
        };
        let marker = PublicEventMarker {
            conversation_id: "group-1".to_string(),
            event_id: "event-2".to_string(),
            command_id: command.command_id.clone(),
            sending_endpoint: Some(model_endpoint(&endpoint)),
        };
        let endpoint_payload = marker.encode_to_vec();
        let endpoint_payload_sha256 = Sha256::digest(&endpoint_payload).to_vec();
        let mut event = ConversationEvent {
            event_id: "event-2".to_string(),
            conversation_id: "group-1".to_string(),
            sequence: 2,
            command_id: command.command_id.clone(),
            actor: Some(model_endpoint(&endpoint)),
            previous_hash: vec![7; 32],
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 1,
            payload: Some(conversation_event::Payload::MembershipTransitionCommitted(
                MembershipTransitionCommittedFact {
                    transition_id: transition.transition_id.clone(),
                    from_membership_epoch: 0,
                    to_membership_epoch: 1,
                    from_mls_epoch: 0,
                    to_mls_epoch: 1,
                    changes: transition
                        .changes
                        .iter()
                        .map(|change| MessagingMembershipChangeCommitted {
                            action: change.action,
                            ptid: change.ptid.clone(),
                            device_id: change.device_id.clone(),
                            home_station_id: change.home_station_id.clone(),
                            role: change.role.clone(),
                        })
                        .collect(),
                    mls_commit_sha256: transition.mls_commit_sha256.clone(),
                    leave_intent_id: String::new(),
                    post_state: None,
                },
            )),
        };
        let commitment = delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &endpoint.ptid,
            &endpoint.device_id,
            PreparedEndpointPayloadKind::PublicEvent,
            &endpoint_payload_sha256,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(model_endpoint(&endpoint)),
            payload_kind: PreparedEndpointPayloadKind::PublicEvent as i32,
            endpoint_payload,
            endpoint_payload_sha256,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![1; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        let item = DeviceQueueItem {
            item_id: "item-2".to_string(),
            recipient: Some(model_endpoint(&endpoint)),
            lane_sequence: 1,
            event_id: "event-2".to_string(),
            conversation_id: "group-1".to_string(),
            idempotency_key: "event:event-2".to_string(),
            payload_type: DeviceQueuePayloadType::ConversationEvent as i32,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        };
        let processor =
            MlsSenderTransitionProcessor::new(alice.clone(), store.clone(), endpoint, now).unwrap();
        processor.consume(&item, 1).unwrap();
        assert!(alice.has_session("group-1"));
        assert!(store.pending_mls_transition("group-1").unwrap().is_none());
        assert_eq!(store.authority_head("group-1").unwrap().0, 2);
        assert_eq!(store.conversation_projections().unwrap()[0].mls_epoch, 1);
    }
}
