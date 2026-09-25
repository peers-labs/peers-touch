use crate::codec::verification::verify_device_event_delivery;
use crate::contracts::{
    ConversationProjection, ConversationStateReceiveCommit, CryptoEndpoint, InteractionMutation,
    InteractionReceiveCommit, MemberAuthorityReceiveCommit, PublicEventReceiveCommit,
    ReceiveCommitResult,
};
use crate::mls::inbound::authority_snapshot_projection;
use crate::proto::chat::{
    conversation_event, ConversationEvent, ConversationMemberAuthorityAction,
    ConversationMemberAuthorityCommittedFact, DeviceConsumptionReceipt, DeviceInboxPayloadType,
    DurableDeviceInboxItem, MemberRole, MessageEditedFact, MessageForwardedFact,
    MessageHiddenForActorFact, MessageModeratedFact, MessagePinCommittedFact, MessageRetractedFact,
    MessagingContentKind, PreparedEndpointPayloadKind, PublicEventMarker, ReactionCommittedFact,
};
use crate::store::MessagingRepository;

use super::ClaimedItemConsumer;
use prost::Message;
use std::sync::Arc;

pub struct PublicEventProcessor<R> {
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: MessagingRepository> PublicEventProcessor<R> {
    pub fn new(
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging public-event processor requires complete endpoint".to_string());
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
        if DeviceInboxPayloadType::try_from(item.payload_type)
            .map_err(|_| "messaging public-event queue payload type is invalid".to_string())?
            != DeviceInboxPayloadType::ConversationEvent
        {
            return Err(
                "messaging public-event processor received wrong queue payload type".to_string(),
            );
        }
        let delivery =
            verify_device_event_delivery(item, &self.endpoint.ptid, &self.endpoint.device_id)?;
        if PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging public-event payload kind is invalid".to_string())?
            != PreparedEndpointPayloadKind::PublicEvent
        {
            return Err("messaging public-event processor received non-marker payload".to_string());
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging public-event delivery has no event".to_string())?;
        let committed_at_unix_ms = event
            .committed_at
            .as_ref()
            .map(|timestamp| {
                timestamp
                    .seconds
                    .saturating_mul(1_000)
                    .saturating_add(i64::from(timestamp.nanos) / 1_000_000)
            })
            .unwrap_or(now);

        match event.payload.as_ref() {
            Some(conversation_event::Payload::MessageCommitted(message)) => self
                .process_message_committed(
                    item,
                    event,
                    message,
                    &delivery,
                    consumer_epoch,
                    now,
                    committed_at_unix_ms,
                ),
            Some(conversation_event::Payload::MessageEdited(fact)) => self.process_message_edited(
                item,
                event,
                fact,
                consumer_epoch,
                now,
                committed_at_unix_ms,
            ),
            Some(conversation_event::Payload::MessageRetracted(fact)) => {
                self.process_message_retracted(item, event, fact, consumer_epoch, now)
            }
            Some(conversation_event::Payload::MessageHiddenForActor(fact)) => {
                self.process_message_hidden_for_actor(item, event, fact, consumer_epoch, now)
            }
            Some(conversation_event::Payload::MessageModerated(fact)) => self
                .process_message_moderated(
                    item,
                    event,
                    fact,
                    consumer_epoch,
                    now,
                    committed_at_unix_ms,
                ),
            Some(conversation_event::Payload::MessageForwarded(fact)) => self
                .process_message_forwarded(
                    item,
                    event,
                    fact,
                    &delivery,
                    consumer_epoch,
                    now,
                    committed_at_unix_ms,
                ),
            Some(conversation_event::Payload::ReactionCommitted(fact)) => {
                self.process_reaction(item, event, fact, consumer_epoch, now, committed_at_unix_ms)
            }
            Some(conversation_event::Payload::MessagePinCommitted(fact)) => {
                self.process_pin(item, event, fact, consumer_epoch, now, committed_at_unix_ms)
            }
            Some(conversation_event::Payload::MemberAuthorityCommitted(fact)) => {
                self.process_member_authority(item, event, fact, &delivery, consumer_epoch, now)
            }
            _ => Err("messaging public-event payload type is unsupported".to_string()),
        }
    }

    fn process_message_committed(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::proto::chat::ConversationEvent,
        message: &crate::proto::chat::MessageCommittedFact,
        delivery: &crate::proto::chat::DeviceEventDelivery,
        consumer_epoch: u64,
        now: i64,
        committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        if MessagingContentKind::try_from(message.content_kind)
            .map_err(|_| "messaging public-event content kind is invalid".to_string())?
            != MessagingContentKind::Text
        {
            return Err("messaging public-event only accepts text projections".to_string());
        }
        let marker = PublicEventMarker::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging public-event marker is invalid".to_string())?;
        validate_marker_bindings(event, message, &marker, &self.endpoint)?;

        let receipt = self.build_receipt(item, event, now);
        let receipt_bytes = receipt.encode_to_vec();
        self.store.commit_public_event(&PublicEventReceiveCommit {
            item_id: &item.item_id,
            event_id: &event.event_id,
            conversation_id: &event.conversation_id,
            command_id: &event.command_id,
            message_id: &message.message_id,
            event_sequence: event.sequence,
            lane_sequence: item.lane_sequence,
            consumer_epoch,
            payload_sha256: &item.payload_sha256,
            event_hash: &event.event_hash,
            previous_event_hash: &event.previous_hash,
            sender_ptid: &self.endpoint.ptid,
            sender_device_id: &self.endpoint.device_id,
            attachments: &message.attachments,
            reply_to_message_id: (!message.reply_to_message_id.is_empty())
                .then_some(message.reply_to_message_id.as_str()),
            thread_root_message_id: (!message.thread_root_message_id.is_empty())
                .then_some(message.thread_root_message_id.as_str()),
            committed_at_unix_ms,
            receipt_id: &receipt.receipt_id,
            receipt_bytes: &receipt_bytes,
            consumed_at_unix_ms: now,
        })?;
        Ok(())
    }

    fn process_message_edited(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::proto::chat::ConversationEvent,
        fact: &MessageEditedFact,
        consumer_epoch: u64,
        now: i64,
        committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        if fact.message_id.trim().is_empty() {
            return Err("messaging public-event edit has no message ID".to_string());
        }
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::Edit {
                edited_text: "",
                edited_at_unix_ms: committed_at_unix_ms,
            },
            now,
        )?;
        Ok(())
    }

    fn process_message_retracted(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::proto::chat::ConversationEvent,
        fact: &MessageRetractedFact,
        consumer_epoch: u64,
        now: i64,
    ) -> Result<(), String> {
        if fact.message_id.trim().is_empty() {
            return Err("messaging public-event retract has no message ID".to_string());
        }
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::Retract,
            now,
        )?;
        Ok(())
    }

    fn process_message_hidden_for_actor(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::proto::chat::ConversationEvent,
        fact: &MessageHiddenForActorFact,
        consumer_epoch: u64,
        now: i64,
    ) -> Result<(), String> {
        if fact.message_id.trim().is_empty() || fact.actor_ptid != self.endpoint.ptid {
            return Err("messaging actor-hide event is not bound to this actor".to_string());
        }
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::HideForActor,
            now,
        )?;
        Ok(())
    }

    fn process_message_moderated(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::proto::chat::ConversationEvent,
        fact: &MessageModeratedFact,
        consumer_epoch: u64,
        now: i64,
        committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        let moderator_ptid = fact
            .moderator
            .as_ref()
            .map(|endpoint| endpoint.ptid.as_str())
            .unwrap_or("");
        if fact.message_id.trim().is_empty()
            || moderator_ptid.is_empty()
            || fact.reason_code.trim().is_empty()
        {
            return Err("messaging moderation event is incomplete".to_string());
        }
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::Moderate {
                moderator_ptid,
                reason_code: &fact.reason_code,
                moderated_at_unix_ms: committed_at_unix_ms,
            },
            now,
        )?;
        Ok(())
    }

    fn process_message_forwarded(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::proto::chat::ConversationEvent,
        fact: &MessageForwardedFact,
        delivery: &crate::proto::chat::DeviceEventDelivery,
        consumer_epoch: u64,
        now: i64,
        committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        self.process_message_committed(
            item,
            event,
            &crate::proto::chat::MessageCommittedFact {
                message_id: fact.destination_message_id.clone(),
                sender: fact.sender.clone(),
                content_kind: fact.content_kind,
                reply_to_message_id: String::new(),
                thread_root_message_id: String::new(),
                attachments: fact.destination_attachments.clone(),
                client_timestamp: fact.client_timestamp.clone(),
            },
            delivery,
            consumer_epoch,
            now,
            committed_at_unix_ms,
        )
    }

    fn process_reaction(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::proto::chat::ConversationEvent,
        fact: &ReactionCommittedFact,
        consumer_epoch: u64,
        now: i64,
        committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        if fact.message_id.trim().is_empty() || fact.reaction.trim().is_empty() {
            return Err("messaging public-event reaction is incomplete".to_string());
        }
        let actor_ptid = fact
            .actor
            .as_ref()
            .map(|endpoint| endpoint.ptid.as_str())
            .unwrap_or(&self.endpoint.ptid);
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::Reaction {
                actor_ptid,
                reaction: &fact.reaction,
                removed: fact.removed,
                created_at_unix_ms: committed_at_unix_ms,
            },
            now,
        )?;
        Ok(())
    }

    fn process_pin(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::proto::chat::ConversationEvent,
        fact: &MessagePinCommittedFact,
        consumer_epoch: u64,
        now: i64,
        committed_at_unix_ms: i64,
    ) -> Result<(), String> {
        if fact.message_id.trim().is_empty() {
            return Err("messaging public-event pin has no message ID".to_string());
        }
        let actor_ptid = fact
            .actor
            .as_ref()
            .map(|endpoint| endpoint.ptid.as_str())
            .unwrap_or(&self.endpoint.ptid);
        self.commit_interaction(
            item,
            event,
            consumer_epoch,
            &fact.message_id,
            InteractionMutation::Pin {
                actor_ptid,
                removed: fact.removed,
                pinned_at_unix_ms: committed_at_unix_ms,
            },
            now,
        )?;
        Ok(())
    }

    fn process_member_authority(
        &self,
        item: &DurableDeviceInboxItem,
        event: &ConversationEvent,
        fact: &ConversationMemberAuthorityCommittedFact,
        delivery: &crate::proto::chat::DeviceEventDelivery,
        consumer_epoch: u64,
        now: i64,
    ) -> Result<(), String> {
        let marker = PublicEventMarker::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging member-authority marker is invalid".to_string())?;
        validate_authority_marker_bindings(event, &marker)?;
        validate_member_authority_fact(event, fact, &self.endpoint.ptid)?;
        let snapshot = fact
            .post_state
            .as_ref()
            .ok_or_else(|| "messaging member-authority snapshot is missing".to_string())?;
        let authority = authority_snapshot_projection(event, snapshot, now)?;
        let projection = ConversationProjection {
            conversation_id: authority.conversation_id,
            authority_station_id: authority.authority_station_id,
            federation_id: authority.federation_id,
            kind: authority.kind,
            name: authority.name,
            owner_ptid: authority.owner_ptid,
            members: authority.members,
            membership_epoch: authority.membership_epoch,
            mls_epoch: authority.mls_epoch,
            active: authority.active,
            updated_at_unix_ms: authority.updated_at_unix_ms,
        };
        let receipt = self.build_receipt(item, event, now);
        let receipt_bytes = receipt.encode_to_vec();
        self.store
            .commit_member_authority_state(&MemberAuthorityReceiveCommit {
                state: ConversationStateReceiveCommit {
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
                },
                command_id: &event.command_id,
                operator_ptid: event
                    .actor
                    .as_ref()
                    .map(|actor| actor.ptid.as_str())
                    .unwrap_or_default(),
                operator_device_id: event
                    .actor
                    .as_ref()
                    .map(|actor| actor.device_id.as_str())
                    .unwrap_or_default(),
                action: fact.action,
                target_ptid: &fact.target_ptid,
            })?;
        Ok(())
    }

    fn commit_interaction(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::proto::chat::ConversationEvent,
        consumer_epoch: u64,
        message_id: &str,
        mutation: InteractionMutation<'_>,
        now: i64,
    ) -> Result<ReceiveCommitResult, String> {
        let receipt = self.build_receipt(item, event, now);
        let receipt_bytes = receipt.encode_to_vec();
        self.store
            .commit_interaction_event(&InteractionReceiveCommit {
                item_id: &item.item_id,
                event_id: &event.event_id,
                command_id: &event.command_id,
                conversation_id: &event.conversation_id,
                event_sequence: event.sequence,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                event_hash: &event.event_hash,
                previous_event_hash: &event.previous_hash,
                message_id,
                mutation,
                mls_session_state: None,
                membership_epoch: event.membership_epoch,
                mls_epoch: event.mls_epoch,
                receipt_id: &receipt.receipt_id,
                receipt_bytes: &receipt_bytes,
                consumed_at_unix_ms: now,
            })
    }

    fn build_receipt(
        &self,
        item: &DurableDeviceInboxItem,
        event: &crate::proto::chat::ConversationEvent,
        now: i64,
    ) -> DeviceConsumptionReceipt {
        DeviceConsumptionReceipt {
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
        }
    }
}

impl<R: MessagingRepository> ClaimedItemConsumer for PublicEventProcessor<R> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

fn validate_marker_bindings(
    event: &crate::proto::chat::ConversationEvent,
    message: &crate::proto::chat::MessageCommittedFact,
    marker: &PublicEventMarker,
    endpoint: &CryptoEndpoint,
) -> Result<(), String> {
    let local = crate::proto::chat::CryptoEndpoint {
        ptid: endpoint.ptid.clone(),
        device_id: endpoint.device_id.clone(),
    };
    if marker.conversation_id != event.conversation_id
        || marker.event_id != event.event_id
        || marker.command_id != event.command_id
        || marker.sending_endpoint.as_ref() != Some(&local)
        || event.actor.as_ref() != Some(&local)
        || message.sender.as_ref() != Some(&local)
        || message.message_id.trim().is_empty()
    {
        return Err("messaging public-event marker binding mismatch".to_string());
    }
    Ok(())
}

fn validate_authority_marker_bindings(
    event: &ConversationEvent,
    marker: &PublicEventMarker,
) -> Result<(), String> {
    if marker.conversation_id != event.conversation_id
        || marker.event_id != event.event_id
        || marker.command_id != event.command_id
        || marker.sending_endpoint.is_none()
        || marker.sending_endpoint != event.actor
    {
        return Err("messaging member-authority marker binding mismatch".to_string());
    }
    Ok(())
}

fn validate_member_authority_fact(
    event: &ConversationEvent,
    fact: &ConversationMemberAuthorityCommittedFact,
    local_ptid: &str,
) -> Result<(), String> {
    let action = ConversationMemberAuthorityAction::try_from(fact.action)
        .map_err(|_| "messaging member-authority action is invalid".to_string())?;
    let snapshot = fact
        .post_state
        .as_ref()
        .ok_or_else(|| "messaging member-authority snapshot is missing".to_string())?;
    let target = snapshot
        .active_members
        .iter()
        .find(|member| member.ptid == fact.target_ptid)
        .ok_or_else(|| "messaging member-authority target is not active".to_string())?;
    if action == ConversationMemberAuthorityAction::Unspecified
        || fact.target_ptid.trim().is_empty()
        || fact.from_membership_epoch <= 0
        || fact.to_membership_epoch != fact.from_membership_epoch.saturating_add(1)
        || fact.to_membership_epoch != event.membership_epoch
        || snapshot.owner_ptid != fact.owner_ptid
        || snapshot.membership_epoch != event.membership_epoch
        || snapshot.mls_epoch != event.mls_epoch
        || !snapshot
            .active_members
            .iter()
            .any(|member| member.ptid == local_ptid)
    {
        return Err("messaging member-authority fact is inconsistent".to_string());
    }
    match action {
        ConversationMemberAuthorityAction::UpdateMember => {
            if fact.previous_owner_ptid != fact.owner_ptid
                || (fact.role.is_none() && fact.muted.is_none())
                || fact.role.is_some_and(|role| {
                    authority_member_role(&target.role)
                        .ok()
                        .map(|value| value as i32)
                        != Some(role)
                })
                || fact.muted.is_some_and(|muted| target.muted != muted)
                || fact.muted_until != target.muted_until
                || (fact.muted == Some(false) && fact.muted_until.is_some())
                || (fact.muted_until.is_some() && fact.muted != Some(true))
            {
                return Err("messaging member-authority update is incomplete".to_string());
            }
        }
        ConversationMemberAuthorityAction::TransferOwnership => {
            if fact.previous_owner_ptid == fact.owner_ptid
                || fact.owner_ptid != fact.target_ptid
                || fact.role != Some(MemberRole::Owner as i32)
                || fact.muted != Some(false)
                || fact.muted_until.is_some()
                || target.role != "owner"
            {
                return Err("messaging ownership-transfer fact is inconsistent".to_string());
            }
        }
        ConversationMemberAuthorityAction::Unspecified => unreachable!(),
    }
    Ok(())
}

fn authority_member_role(role: &str) -> Result<MemberRole, String> {
    match role {
        "member" | "MEMBER_ROLE_MEMBER" => Ok(MemberRole::Member),
        "admin" | "MEMBER_ROLE_ADMIN" => Ok(MemberRole::Admin),
        "owner" | "MEMBER_ROLE_OWNER" => Ok(MemberRole::Owner),
        _ => Err("messaging member-authority member role is invalid".to_string()),
    }
}
