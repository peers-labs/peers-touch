use crate::codec::verification::verify_device_event_delivery;
use crate::contracts::{
    ConversationAuthorityMemberProjection, ConversationProjection, ConversationStateReceiveCommit,
    CryptoEndpoint, ReceiveCommitResult,
};
use crate::proto::chat::{
    conversation_event, ConversationStateMarker, DeviceConsumptionReceipt, DurableDeviceInboxItem,
    MemberRole, PreparedEndpointPayloadKind,
};
use crate::store::MessagingRepository;

use super::ClaimedItemConsumer;
use prost::Message;
use std::sync::Arc;

pub struct ConversationStateProcessor<R> {
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: MessagingRepository> ConversationStateProcessor<R> {
    pub fn new(
        store: Arc<R>,
        endpoint: CryptoEndpoint,
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
        let members = post_state
            .active_members
            .iter()
            .map(authority_member_projection)
            .collect::<Result<Vec<_>, String>>()?;
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
            consumer: Some(crate::proto::chat::CryptoEndpoint {
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

fn authority_member_projection(
    member: &crate::proto::chat::ConversationAuthorityMember,
) -> Result<ConversationAuthorityMemberProjection, String> {
    let role = match member.role.as_str() {
        "member" | "MEMBER_ROLE_MEMBER" => MemberRole::Member,
        "admin" | "MEMBER_ROLE_ADMIN" => MemberRole::Admin,
        "owner" | "MEMBER_ROLE_OWNER" => MemberRole::Owner,
        _ => return Err("messaging conversation-state member role is invalid".to_string()),
    };
    Ok(ConversationAuthorityMemberProjection {
        ptid: member.ptid.clone(),
        role: role as i32,
        home_station_peer_id: member.home_station_peer_id.clone(),
        muted: member.muted,
        muted_until_unix_ms: member.muted_until.as_ref().map(|timestamp| {
            timestamp
                .seconds
                .saturating_mul(1_000)
                .saturating_add(i64::from(timestamp.nanos) / 1_000_000)
        }),
    })
}

impl<R: MessagingRepository> ClaimedItemConsumer for ConversationStateProcessor<R> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}
