use super::mls::{authority_snapshot_projection, validate_authority_snapshot};
use super::{
    verify_device_event_delivery, ClaimedItemConsumer, EngineEndpoint, MessagingStore,
    MlsRetirementReceiveCommit, ReceiveCommitResult,
};
use crate::domain::mls_group::MlsGroupManager;
use crate::model::chat::{
    conversation_event, CryptoEndpoint, DeviceConsumptionReceipt, DeviceQueueItem,
    MessagingMembershipAction, MlsRetirementMarker, PreparedEndpointPayloadKind,
};
use prost::Message;
use std::sync::Arc;

pub struct MlsRetirementProcessor {
    manager: Arc<MlsGroupManager>,
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
    clock: fn() -> i64,
}

impl MlsRetirementProcessor {
    pub fn new(
        manager: Arc<MlsGroupManager>,
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging MLS retirement processor requires endpoint".to_string());
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
            self.manager.remove_session(&item.conversation_id);
            return Ok(());
        }

        let delivery =
            verify_device_event_delivery(item, &self.endpoint.ptid, &self.endpoint.device_id)?;
        if PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging MLS retirement payload kind is invalid".to_string())?
            != PreparedEndpointPayloadKind::MlsRetirement
        {
            return Err("messaging MLS retirement received wrong payload kind".to_string());
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging MLS retirement has no authority event".to_string())?;
        let transition = match event.payload.as_ref() {
            Some(conversation_event::Payload::MembershipTransitionCommitted(transition)) => {
                transition
            }
            _ => return Err("messaging MLS retirement has no transition fact".to_string()),
        };
        let marker = MlsRetirementMarker::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging MLS retirement marker is invalid".to_string())?;
        let local_endpoint = CryptoEndpoint {
            ptid: self.endpoint.ptid.clone(),
            device_id: self.endpoint.device_id.clone(),
        };
        if marker.conversation_id != event.conversation_id
            || marker.event_id != event.event_id
            || marker.transition_id != transition.transition_id
            || marker.removed_endpoint.as_ref() != Some(&local_endpoint)
        {
            return Err("messaging MLS retirement marker binding mismatch".to_string());
        }
        let local_removed = transition.changes.iter().any(|change| {
            change.ptid == self.endpoint.ptid
                && match MessagingMembershipAction::try_from(change.action) {
                    Ok(MessagingMembershipAction::RemoveActor) => true,
                    Ok(MessagingMembershipAction::RemoveDevice) => {
                        change.device_id == self.endpoint.device_id
                    }
                    _ => false,
                }
        });
        let snapshot = transition
            .post_state
            .as_ref()
            .ok_or_else(|| "messaging MLS retirement has no authority snapshot".to_string())?;
        validate_authority_snapshot(event, Some(snapshot))?;
        let endpoint_still_active = snapshot
            .active_endpoints
            .iter()
            .any(|endpoint| endpoint == &local_endpoint);
        if !local_removed || endpoint_still_active {
            return Err("messaging MLS retirement does not remove local endpoint".to_string());
        }
        let mut projection = authority_snapshot_projection(event, snapshot, now)?;
        projection.active = snapshot
            .active_members
            .iter()
            .any(|member| member.ptid == self.endpoint.ptid);
        let receipt = DeviceConsumptionReceipt {
            receipt_id: format!("device-consumed:{}", item.item_id),
            conversation_id: event.conversation_id.clone(),
            event_id: event.event_id.clone(),
            consumer: Some(local_endpoint),
            event_sequence: event.sequence,
            lane_sequence: item.lane_sequence,
            payload_sha256: item.payload_sha256.clone(),
            consumed_at: Some(prost_types::Timestamp {
                seconds: now.div_euclid(1_000),
                nanos: (now.rem_euclid(1_000) * 1_000_000) as i32,
            }),
        };
        let receipt_bytes = receipt.encode_to_vec();
        let result = self
            .store
            .commit_mls_retirement(&MlsRetirementReceiveCommit {
                item_id: &item.item_id,
                event_id: &event.event_id,
                conversation_id: &event.conversation_id,
                event_sequence: event.sequence,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                event_hash: &event.event_hash,
                previous_event_hash: &event.previous_hash,
                transition_id: &transition.transition_id,
                endpoint_ptid: &self.endpoint.ptid,
                endpoint_device_id: &self.endpoint.device_id,
                membership_epoch: event.membership_epoch,
                mls_epoch: event.mls_epoch,
                projection: &projection,
                receipt_id: &receipt.receipt_id,
                receipt_bytes: &receipt_bytes,
                consumed_at_unix_ms: now,
            })?;
        if result == ReceiveCommitResult::Committed {
            self.manager.remove_session(&event.conversation_id);
        }
        Ok(())
    }
}

impl ClaimedItemConsumer for MlsRetirementProcessor {
    fn consume(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messaging::verification::delivery_commitment;
    use crate::model::chat::{
        ConversationAuthorityMember, ConversationAuthoritySnapshot, ConversationEvent,
        DeviceEventDelivery, DeviceQueuePayloadType, MemberRole, MembershipTransitionCommittedFact,
        MessagingMembershipChangeCommitted,
    };
    use sha2::{Digest, Sha256};

    fn now() -> i64 {
        12_000
    }

    fn retirement_item() -> DeviceQueueItem {
        let local = CryptoEndpoint {
            ptid: "ptid:carol".to_string(),
            device_id: "carol-device-2".to_string(),
        };
        let marker = MlsRetirementMarker {
            conversation_id: "group-1".to_string(),
            event_id: "event-12".to_string(),
            transition_id: "transition-12".to_string(),
            removed_endpoint: Some(local.clone()),
        };
        let endpoint_payload = marker.encode_to_vec();
        let endpoint_payload_sha256 = Sha256::digest(&endpoint_payload).to_vec();
        let mut event = ConversationEvent {
            event_id: "event-12".to_string(),
            conversation_id: "group-1".to_string(),
            sequence: 12,
            command_id: "command-12".to_string(),
            actor: Some(CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            }),
            previous_hash: vec![7; 32],
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 12,
                nanos: 0,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 7,
            mls_epoch: 7,
            authority_station_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MembershipTransitionCommitted(
                MembershipTransitionCommittedFact {
                    transition_id: "transition-12".to_string(),
                    from_membership_epoch: 6,
                    to_membership_epoch: 7,
                    from_mls_epoch: 6,
                    to_mls_epoch: 7,
                    changes: vec![MessagingMembershipChangeCommitted {
                        action: MessagingMembershipAction::RemoveDevice as i32,
                        ptid: local.ptid.clone(),
                        device_id: local.device_id.clone(),
                        role: MemberRole::Member.as_str_name().to_string(),
                        ..Default::default()
                    }],
                    mls_commit_sha256: vec![8; 32],
                    post_state: Some(ConversationAuthoritySnapshot {
                        kind: crate::model::chat::ConversationKind::Group as i32,
                        name: "group".to_string(),
                        owner_ptid: "ptid:alice".to_string(),
                        active_members: vec![
                            ConversationAuthorityMember {
                                ptid: "ptid:alice".to_string(),
                                role: "owner".to_string(),
                            },
                            ConversationAuthorityMember {
                                ptid: "ptid:carol".to_string(),
                                role: "member".to_string(),
                            },
                        ],
                        active_endpoints: vec![
                            CryptoEndpoint {
                                ptid: "ptid:alice".to_string(),
                                device_id: "alice-device".to_string(),
                            },
                            CryptoEndpoint {
                                ptid: "ptid:carol".to_string(),
                                device_id: "carol-device-1".to_string(),
                            },
                        ],
                        membership_epoch: 7,
                        mls_epoch: 7,
                    }),
                    ..Default::default()
                },
            )),
        };
        let commitment = delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &local.ptid,
            &local.device_id,
            PreparedEndpointPayloadKind::MlsRetirement,
            &endpoint_payload_sha256,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(local),
            payload_kind: PreparedEndpointPayloadKind::MlsRetirement as i32,
            endpoint_payload,
            endpoint_payload_sha256,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![1; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        DeviceQueueItem {
            item_id: "item-12".to_string(),
            recipient: delivery.recipient,
            lane_sequence: 1,
            event_id: "event-12".to_string(),
            conversation_id: "group-1".to_string(),
            idempotency_key: "event:event-12".to_string(),
            payload_type: DeviceQueuePayloadType::ConversationEvent as i32,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }

    #[test]
    fn retirement_atomically_removes_live_mls_state_and_is_replay_safe() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .install_test_conversation_projection("group-1", 6, 6)
            .unwrap();
        store
            .install_test_authority_head("group-1", 11, &[7; 32])
            .unwrap();
        store
            .save_mls_session_state("group-1", b"live-session", 6, 6, 1)
            .unwrap();
        let manager = Arc::new(MlsGroupManager::new());
        let processor = MlsRetirementProcessor::new(
            manager,
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:carol".to_string(),
                device_id: "carol-device-2".to_string(),
            },
            now,
        )
        .unwrap();
        let item = retirement_item();

        processor.consume(&item, 1).unwrap();
        processor.consume(&item, 2).unwrap();

        assert!(store.load_mls_session_state("group-1").unwrap().is_none());
        assert!(store.has_mls_retired_checkpoint("group-1").unwrap());
        assert_eq!(store.authority_head("group-1").unwrap().0, 12);
        let projection = store.conversation_projections().unwrap().remove(0);
        assert_eq!(projection.membership_epoch, 7);
        assert_eq!(projection.mls_epoch, 7);
        assert!(projection.active);
    }
}
