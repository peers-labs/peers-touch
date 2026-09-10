use super::{
    verify_device_event_delivery, ClaimedItemConsumer, ConversationMemberProjection,
    ConversationProjection, ConversationStateReceiveCommit, EngineEndpoint, MessagingStore,
    ReceiveCommitResult,
};
use crate::model::chat::{
    conversation_event, ConversationStateMarker, CryptoEndpoint, DeviceConsumptionReceipt,
    DurableDeviceInboxItem, MemberRole, PreparedEndpointPayloadKind,
};
use prost::Message;
use std::sync::Arc;

pub struct ConversationStateProcessor {
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
    clock: fn() -> i64,
}

impl ConversationStateProcessor {
    pub fn new(
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging conversation-state processor requires endpoint".to_string());
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
        let delivery =
            verify_device_event_delivery(item, &self.endpoint.ptid, &self.endpoint.device_id)?;
        if PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging conversation-state payload kind is invalid".to_string())?
            != PreparedEndpointPayloadKind::ConversationState
        {
            return Err("messaging conversation-state payload kind mismatch".to_string());
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging conversation-state event is missing".to_string())?;
        let marker = ConversationStateMarker::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging conversation-state marker is invalid".to_string())?;
        if marker.conversation_id != event.conversation_id || marker.event_id != event.event_id {
            return Err("messaging conversation-state marker binding mismatch".to_string());
        }
        let created = match event.payload.as_ref() {
            Some(conversation_event::Payload::ConversationCreated(created)) => created,
            _ => return Err("messaging conversation-state event is unsupported".to_string()),
        };
        let post_state = created
            .post_state
            .as_ref()
            .filter(|state| !state.federation_id.trim().is_empty())
            .ok_or_else(|| {
                "messaging conversation-state Federation projection is missing".to_string()
            })?;
        if !created
            .members
            .iter()
            .any(|member| member.ptid == self.endpoint.ptid)
        {
            return Err("messaging recipient is not a conversation member".to_string());
        }
        let members = created
            .members
            .iter()
            .map(|member| ConversationMemberProjection {
                ptid: member.ptid.clone(),
                role: match member.role.as_str() {
                    "owner" => MemberRole::Owner as i32,
                    _ => MemberRole::Member as i32,
                },
            })
            .collect();
        let projection = ConversationProjection {
            conversation_id: event.conversation_id.clone(),
            authority_station_id: event.authority_station_peer_id.clone(),
            federation_id: post_state.federation_id.clone(),
            kind: created.kind,
            name: created.name.clone(),
            owner_ptid: created.owner_ptid.clone(),
            members,
            membership_epoch: event.membership_epoch,
            mls_epoch: event.mls_epoch,
            active: true,
            updated_at_unix_ms: now,
        };
        let receipt = DeviceConsumptionReceipt {
            receipt_id: format!("device-consumed:{}", item.item_id),
            conversation_id: event.conversation_id.clone(),
            event_id: event.event_id.clone(),
            consumer: Some(CryptoEndpoint {
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
        let result = self
            .store
            .commit_conversation_state(&ConversationStateReceiveCommit {
                item_id: &item.item_id,
                event_id: &event.event_id,
                conversation_id: &event.conversation_id,
                event_sequence: event.sequence,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                event_hash: &event.event_hash,
                previous_event_hash: &event.previous_hash,
                projection: &projection,
                receipt_id: &receipt.receipt_id,
                receipt_bytes: &receipt_bytes,
                consumed_at_unix_ms: now,
            })?;
        match result {
            ReceiveCommitResult::Committed | ReceiveCommitResult::AlreadyCommitted => Ok(()),
        }
    }
}

impl ClaimedItemConsumer for ConversationStateProcessor {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

#[cfg(test)]
mod tests {
    use super::super::verification::delivery_commitment;
    use super::*;
    use crate::model::chat::{
        ConversationAuthorityMember, ConversationAuthoritySnapshot, ConversationCreatedFact,
        ConversationEvent, ConversationKind, DeviceEventDelivery, DeviceInboxPayloadType,
    };
    use messaging_core::proto::actor_device_ref;
    use sha2::{Digest, Sha256};

    fn now() -> i64 {
        1_000
    }

    #[test]
    fn created_event_atomically_projects_conversation_and_is_replay_safe() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let endpoint = CryptoEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };
        let marker = ConversationStateMarker {
            conversation_id: "direct-1".to_string(),
            event_id: "created:direct-1".to_string(),
        };
        let endpoint_payload = marker.encode_to_vec();
        let endpoint_payload_sha256 = Sha256::digest(&endpoint_payload).to_vec();
        let mut event = ConversationEvent {
            event_id: marker.event_id.clone(),
            conversation_id: marker.conversation_id.clone(),
            sequence: 1,
            command_id: "create:direct-1".to_string(),
            actor: Some(endpoint.clone()),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 0,
            authority_station_peer_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::ConversationCreated(
                ConversationCreatedFact {
                    kind: ConversationKind::Direct as i32,
                    name: String::new(),
                    owner_ptid: "ptid:alice".to_string(),
                    members: vec![
                        ConversationAuthorityMember {
                            ptid: "ptid:alice".to_string(),
                            role: "member".to_string(),
                            home_station_peer_id: "station-local".to_string(),
                        },
                        ConversationAuthorityMember {
                            ptid: "ptid:bob".to_string(),
                            role: "member".to_string(),
                            home_station_peer_id: "station-remote".to_string(),
                        },
                    ],
                    post_state: Some(ConversationAuthoritySnapshot {
                        kind: ConversationKind::Direct as i32,
                        name: String::new(),
                        owner_ptid: "ptid:alice".to_string(),
                        active_members: vec![
                            ConversationAuthorityMember {
                                ptid: "ptid:alice".to_string(),
                                role: "member".to_string(),
                                home_station_peer_id: "station-local".to_string(),
                            },
                            ConversationAuthorityMember {
                                ptid: "ptid:bob".to_string(),
                                role: "member".to_string(),
                                home_station_peer_id: "station-remote".to_string(),
                            },
                        ],
                        federation_id: "federation-1".to_string(),
                        membership_epoch: 1,
                        ..Default::default()
                    }),
                },
            )),
        };
        let commitment = delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &endpoint.ptid,
            &endpoint.device_id,
            PreparedEndpointPayloadKind::ConversationState,
            &endpoint_payload_sha256,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(endpoint.clone()),
            payload_kind: PreparedEndpointPayloadKind::ConversationState as i32,
            endpoint_payload,
            endpoint_payload_sha256,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![1; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        let item = DurableDeviceInboxItem {
            item_id: "item-created-1".to_string(),
            recipient: Some(actor_device_ref(&endpoint.ptid, &endpoint.device_id)),
            lane_sequence: 1,
            event_id: marker.event_id,
            conversation_id: marker.conversation_id,
            idempotency_key: "event:created:direct-1".to_string(),
            payload_type: DeviceInboxPayloadType::ConversationEvent as i32,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        };
        let processor = ConversationStateProcessor::new(
            store.clone(),
            EngineEndpoint {
                ptid: endpoint.ptid,
                device_id: endpoint.device_id,
            },
            now,
        )
        .unwrap();
        processor.consume(&item, 1).unwrap();
        processor.consume(&item, 1).unwrap();
        let projections = store.conversation_projections().unwrap();
        assert_eq!(projections.len(), 1);
        assert_eq!(projections[0].federation_id, "federation-1");
        assert_eq!(
            projections[0]
                .members
                .iter()
                .map(|member| (member.ptid.clone(), member.role))
                .collect::<Vec<_>>(),
            vec![
                ("ptid:alice".to_string(), MemberRole::Member as i32),
                ("ptid:bob".to_string(), MemberRole::Member as i32),
            ]
        );
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 1));
    }
}
