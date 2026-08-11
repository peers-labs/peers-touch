use super::{
    decode_message_private_content, verify_device_event_delivery, ClaimedItemConsumer,
    ConversationProjection, EngineEndpoint, MessageProjection, MessagingStore, MlsReceiveCommit,
    MlsTransitionReceiveCommit, ReceiveCommitResult,
};
use crate::domain::mls_group::{MlsGroupManager, MlsPreparedReceive};
use crate::model::chat::{
    conversation_event, ConversationAuthoritySnapshot, ConversationKind, CryptoEndpoint,
    DeviceConsumptionReceipt, DeviceQueueItem, MemberRole, MembershipTransitionChange,
    MembershipTransitionCommittedFact, MessagingMembershipAction, MlsQueuePayload,
    MlsQueuePayloadKind, PreparedEndpointPayloadKind,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub struct MlsApplicationProcessor {
    manager: Arc<MlsGroupManager>,
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
    clock: fn() -> i64,
}

impl MlsApplicationProcessor {
    pub fn new(
        manager: Arc<MlsGroupManager>,
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging MLS processor requires complete endpoint".to_string());
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
            return Ok(());
        }

        let delivery =
            verify_device_event_delivery(item, &self.endpoint.ptid, &self.endpoint.device_id)?;
        if PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging MLS payload kind is invalid".to_string())?
            != PreparedEndpointPayloadKind::MlsApplication
        {
            return Err("messaging MLS processor received non-application payload".to_string());
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging MLS delivery has no event".to_string())?;
        let (message_id, is_edit, committed_fact) = match event.payload.as_ref() {
            Some(conversation_event::Payload::MessageCommitted(message)) => {
                (message.message_id.as_str(), false, Some(message))
            }
            Some(conversation_event::Payload::MessageEdited(fact)) => {
                if fact.message_id.trim().is_empty() {
                    return Err("messaging MLS edit has no message ID".to_string());
                }
                (fact.message_id.as_str(), true, None)
            }
            _ => return Err("messaging MLS application has unsupported event type".to_string()),
        };
        if !self.manager.has_session(&event.conversation_id) {
            let state = self
                .store
                .load_mls_session_state(&event.conversation_id)?
                .ok_or_else(|| "messaging MLS session is unavailable".to_string())?;
            self.manager
                .import_session_state(&event.conversation_id, &state)?;
        }
        let prepared = self
            .manager
            .prepare_application_message(&event.conversation_id, &delivery.endpoint_payload)?;
        let private_content = decode_message_private_content(&prepared.plaintext)?;
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

        if is_edit {
            self.store
                .apply_message_edit(message_id, &private_content.text, committed_at_unix_ms)?;
            self.store
                .mark_consumed(&item.item_id, &event.event_id, &event.conversation_id, &item.payload_sha256, now)?;
            self.manager
                .install_prepared_application(&event.conversation_id, &prepared)?;
            return Ok(());
        }

        let message = committed_fact
            .ok_or_else(|| "messaging MLS application has no message fact".to_string())?;
        let projection = MessageProjection {
            conversation_id: event.conversation_id.clone(),
            event_id: event.event_id.clone(),
            event_sequence: event.sequence,
            message_id: message.message_id.clone(),
            sender_ptid: message
                .sender
                .as_ref()
                .map(|endpoint| endpoint.ptid.clone())
                .unwrap_or_default(),
            sender_device_id: message
                .sender
                .as_ref()
                .map(|endpoint| endpoint.device_id.clone())
                .unwrap_or_default(),
            plaintext: private_content.text,
            attachments: private_content.attachments,
            committed_at_unix_ms,
            reply_to_message_id: if message.reply_to_message_id.is_empty() {
                None
            } else {
                Some(message.reply_to_message_id.clone())
            },
            edited_text: None,
            edited_at_unix_ms: None,
            retracted: false,
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
        let input = MlsReceiveCommit {
            item_id: &item.item_id,
            event_id: &event.event_id,
            conversation_id: &event.conversation_id,
            lane_sequence: item.lane_sequence,
            consumer_epoch,
            payload_sha256: &item.payload_sha256,
            event_hash: &event.event_hash,
            previous_event_hash: &event.previous_hash,
            session_state: &prepared.session_state,
            membership_epoch: event.membership_epoch,
            mls_epoch: event.mls_epoch,
            projection: &projection,
            reply_to_message_id: projection.reply_to_message_id.as_deref(),
            receipt_id: &receipt.receipt_id,
            receipt_bytes: &receipt_bytes,
            consumed_at_unix_ms: now,
        };
        if self.store.commit_mls_receive(&input)? == ReceiveCommitResult::Committed {
            self.manager
                .install_prepared_application(&event.conversation_id, &prepared)?;
        }
        Ok(())
    }
}

impl ClaimedItemConsumer for MlsApplicationProcessor {
    fn consume(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

pub struct MlsTransitionProcessor {
    manager: Arc<MlsGroupManager>,
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
    clock: fn() -> i64,
}

impl MlsTransitionProcessor {
    pub fn new(
        manager: Arc<MlsGroupManager>,
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err(
                "messaging MLS transition processor requires complete endpoint".to_string(),
            );
        }
        Ok(Self {
            manager,
            store,
            endpoint,
            clock,
        })
    }

    fn load_committed_state(&self, conversation_id: &str) -> Result<(), String> {
        let state = self
            .store
            .load_mls_session_state(conversation_id)?
            .ok_or_else(|| "messaging committed MLS state is unavailable".to_string())?;
        self.manager.import_session_state(conversation_id, &state)?;
        if let Some(provider_pool) = self.store.load_mls_join_provider_pool()? {
            self.manager.import_pending_join_providers(&provider_pool)?;
        }
        Ok(())
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
            self.load_committed_state(&item.conversation_id)?;
            return Ok(());
        }
        let delivery =
            verify_device_event_delivery(item, &self.endpoint.ptid, &self.endpoint.device_id)?;
        let payload_kind = PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging MLS transition payload kind is invalid".to_string())?;
        if !matches!(
            payload_kind,
            PreparedEndpointPayloadKind::MlsCommit | PreparedEndpointPayloadKind::MlsWelcome
        ) {
            return Err("messaging MLS transition received wrong delivery kind".to_string());
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging MLS transition has no authority event".to_string())?;
        let transition = match event.payload.as_ref() {
            Some(conversation_event::Payload::MembershipTransitionCommitted(transition)) => {
                transition
            }
            _ => return Err("messaging MLS delivery has no transition fact".to_string()),
        };
        let payload = MlsQueuePayload::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging MLS queue payload is invalid".to_string())?;
        let queue_kind = MlsQueuePayloadKind::try_from(payload.kind)
            .map_err(|_| "messaging MLS queue kind is invalid".to_string())?;
        let expected_kind = match payload_kind {
            PreparedEndpointPayloadKind::MlsCommit => MlsQueuePayloadKind::Commit,
            PreparedEndpointPayloadKind::MlsWelcome => MlsQueuePayloadKind::Welcome,
            _ => unreachable!(),
        };
        if queue_kind != expected_kind
            || payload.conversation_id != event.conversation_id
            || payload.transition_id != transition.transition_id
            || payload.event_id != event.event_id
            || payload.authority_sequence != event.sequence
            || payload.from_membership_epoch != transition.from_membership_epoch
            || payload.to_membership_epoch != transition.to_membership_epoch
            || payload.from_mls_epoch != transition.from_mls_epoch
            || payload.to_mls_epoch != transition.to_mls_epoch
            || payload.recipient.as_ref()
                != Some(&CryptoEndpoint {
                    ptid: self.endpoint.ptid.clone(),
                    device_id: self.endpoint.device_id.clone(),
                })
            || payload.payload_sha256.len() != 32
            || Sha256::digest(&payload.opaque_mls_bytes).as_slice() != payload.payload_sha256
        {
            return Err("messaging MLS transition binding mismatch".to_string());
        }
        validate_authority_snapshot(event, transition.post_state.as_ref())?;
        let join_projection = if queue_kind == MlsQueuePayloadKind::Welcome {
            let (local_sequence, _) = self.store.authority_head(&event.conversation_id)?;
            if local_sequence == 0
                || self
                    .store
                    .has_mls_retired_checkpoint(&event.conversation_id)?
            {
                Some(join_checkpoint_projection(
                    event,
                    transition,
                    &self.endpoint,
                    now,
                )?)
            } else {
                None
            }
        } else {
            None
        };
        let changes = transition
            .changes
            .iter()
            .map(|change| MembershipTransitionChange {
                ptid: change.ptid.clone(),
                actor_home_station_peer_id: change.home_station_id.clone(),
                action: change.action,
                role: MemberRole::Unspecified as i32,
                device_id: change.device_id.clone(),
            })
            .collect::<Vec<_>>();
        let prepared: MlsPreparedReceive = match queue_kind {
            MlsQueuePayloadKind::Commit => {
                if !self.manager.has_session(&event.conversation_id) {
                    self.load_committed_state(&event.conversation_id)?;
                }
                self.manager.prepare_received_commit(
                    &event.conversation_id,
                    &payload.opaque_mls_bytes,
                    &changes,
                )?
            }
            MlsQueuePayloadKind::Welcome => {
                if let Some(provider_pool) = self.store.load_mls_join_provider_pool()? {
                    self.manager.import_pending_join_providers(&provider_pool)?;
                }
                self.manager.prepare_received_welcome(
                    &event.conversation_id,
                    &payload.opaque_mls_bytes,
                    &changes,
                )?
            }
            _ => return Err("messaging MLS transition kind is unsupported".to_string()),
        };
        let receipt = consumption_receipt(item, event, &self.endpoint, now);
        let receipt_bytes = receipt.encode_to_vec();
        let input = MlsTransitionReceiveCommit {
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
            transition_kind: payload.kind,
            session_state: &prepared.session_state,
            provider_pool_state: prepared.provider_pool_state.as_deref(),
            from_membership_epoch: transition.from_membership_epoch,
            to_membership_epoch: transition.to_membership_epoch,
            from_mls_epoch: transition.from_mls_epoch,
            to_mls_epoch: transition.to_mls_epoch,
            join_projection: join_projection.as_ref(),
            receipt_id: &receipt.receipt_id,
            receipt_bytes: &receipt_bytes,
            consumed_at_unix_ms: now,
        };
        if self.store.commit_mls_transition(&input)? == ReceiveCommitResult::Committed {
            self.manager
                .install_received_state(&event.conversation_id, &prepared)?;
        }
        Ok(())
    }
}

impl ClaimedItemConsumer for MlsTransitionProcessor {
    fn consume(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

pub(super) fn validate_authority_snapshot(
    event: &crate::model::chat::ConversationEvent,
    snapshot: Option<&ConversationAuthoritySnapshot>,
) -> Result<(), String> {
    let snapshot =
        snapshot.ok_or_else(|| "messaging MLS transition has no authority snapshot".to_string())?;
    if snapshot.kind != ConversationKind::Group as i32
        || snapshot.owner_ptid.trim().is_empty()
        || snapshot.membership_epoch != event.membership_epoch
        || snapshot.mls_epoch != event.mls_epoch
        || snapshot.active_members.is_empty()
        || snapshot.active_endpoints.is_empty()
    {
        return Err("messaging MLS authority snapshot is invalid".to_string());
    }
    let mut previous_member = None;
    let mut owner_present = false;
    for member in &snapshot.active_members {
        if member.ptid.trim().is_empty()
            || member.role.trim().is_empty()
            || previous_member.is_some_and(|value: &str| value >= member.ptid.as_str())
        {
            return Err("messaging MLS authority members are not canonical".to_string());
        }
        owner_present |= member.ptid == snapshot.owner_ptid;
        previous_member = Some(member.ptid.as_str());
    }
    let mut previous_endpoint: Option<(&str, &str)> = None;
    for endpoint in &snapshot.active_endpoints {
        let key = (endpoint.ptid.as_str(), endpoint.device_id.as_str());
        if key.0.is_empty()
            || key.1.is_empty()
            || previous_endpoint.is_some_and(|value| value >= key)
        {
            return Err("messaging MLS authority endpoints are not canonical".to_string());
        }
        if !snapshot
            .active_members
            .iter()
            .any(|member| member.ptid == endpoint.ptid)
        {
            return Err("messaging MLS endpoint has no active actor membership".to_string());
        }
        previous_endpoint = Some(key);
    }
    if !owner_present {
        return Err("messaging MLS authority owner is not active".to_string());
    }
    Ok(())
}

fn join_checkpoint_projection(
    event: &crate::model::chat::ConversationEvent,
    transition: &MembershipTransitionCommittedFact,
    endpoint: &EngineEndpoint,
    now: i64,
) -> Result<ConversationProjection, String> {
    let snapshot = transition.post_state.as_ref();
    validate_authority_snapshot(event, snapshot)?;
    let snapshot = snapshot.expect("validated authority snapshot");
    let local_added = transition.changes.iter().any(|change| {
        change.ptid == endpoint.ptid
            && change.device_id == endpoint.device_id
            && matches!(
                MessagingMembershipAction::try_from(change.action),
                Ok(MessagingMembershipAction::AddActor | MessagingMembershipAction::AddDevice)
            )
    });
    let local_member = snapshot
        .active_members
        .iter()
        .any(|member| member.ptid == endpoint.ptid);
    let local_endpoint = snapshot.active_endpoints.iter().any(|candidate| {
        candidate.ptid == endpoint.ptid && candidate.device_id == endpoint.device_id
    });
    if !local_added || !local_member || !local_endpoint {
        return Err("messaging MLS Welcome is not a local join checkpoint".to_string());
    }
    authority_snapshot_projection(event, snapshot, now)
}

pub(super) fn authority_snapshot_projection(
    event: &crate::model::chat::ConversationEvent,
    snapshot: &ConversationAuthoritySnapshot,
    now: i64,
) -> Result<ConversationProjection, String> {
    validate_authority_snapshot(event, Some(snapshot))?;
    Ok(ConversationProjection {
        conversation_id: event.conversation_id.clone(),
        authority_station_id: event.authority_station_id.clone(),
        kind: snapshot.kind,
        name: snapshot.name.clone(),
        owner_ptid: snapshot.owner_ptid.clone(),
        member_ptids: snapshot
            .active_members
            .iter()
            .map(|member| member.ptid.clone())
            .collect(),
        membership_epoch: snapshot.membership_epoch,
        mls_epoch: snapshot.mls_epoch,
        active: true,
        updated_at_unix_ms: now,
    })
}

fn consumption_receipt(
    item: &DeviceQueueItem,
    event: &crate::model::chat::ConversationEvent,
    endpoint: &EngineEndpoint,
    now: i64,
) -> DeviceConsumptionReceipt {
    DeviceConsumptionReceipt {
        receipt_id: format!("device-consumed:{}", item.item_id),
        conversation_id: event.conversation_id.clone(),
        event_id: event.event_id.clone(),
        consumer: Some(CryptoEndpoint {
            ptid: endpoint.ptid.clone(),
            device_id: endpoint.device_id.clone(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::mls_group::MlsMemberKeyPackage;
    use crate::messaging::verification::delivery_commitment;
    use crate::model::chat::{
        conversation_event, ConversationAuthorityMember, ConversationEvent, DeviceEventDelivery,
        MembershipTransitionCommittedFact, MessageCommittedFact, MessagingContentKind,
        MessagingMembershipAction, MessagingMembershipChangeCommitted,
    };
    use sha2::{Digest, Sha256};

    fn now() -> i64 {
        100
    }

    fn authority_snapshot(membership_epoch: i64, mls_epoch: i64) -> ConversationAuthoritySnapshot {
        ConversationAuthoritySnapshot {
            kind: ConversationKind::Group as i32,
            name: "Test group".to_string(),
            owner_ptid: "ptid:alice".to_string(),
            active_members: vec![
                ConversationAuthorityMember {
                    ptid: "ptid:alice".to_string(),
                    role: "owner".to_string(),
                },
                ConversationAuthorityMember {
                    ptid: "ptid:bob".to_string(),
                    role: "member".to_string(),
                },
            ],
            active_endpoints: vec![
                CryptoEndpoint {
                    ptid: "ptid:alice".to_string(),
                    device_id: "alice-device".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                },
            ],
            membership_epoch,
            mls_epoch,
        }
    }

    fn queue_item(ciphertext: Vec<u8>) -> DeviceQueueItem {
        let recipient = CryptoEndpoint {
            ptid: "ptid:bob".to_string(),
            device_id: "bob-device".to_string(),
        };
        let payload_hash = Sha256::digest(&ciphertext).to_vec();
        let mut event = ConversationEvent {
            event_id: "event-1".to_string(),
            conversation_id: "group-1".to_string(),
            sequence: 1,
            command_id: "command-1".to_string(),
            actor: Some(CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            }),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 0,
                nanos: 100_000_000,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 1,
            authority_station_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MessageCommitted(
                MessageCommittedFact {
                    message_id: "message-1".to_string(),
                    sender: Some(CryptoEndpoint {
                        ptid: "ptid:alice".to_string(),
                        device_id: "alice-device".to_string(),
                    }),
                    content_kind: MessagingContentKind::Text as i32,
                    ..Default::default()
                },
            )),
        };
        let commitment = delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &recipient.ptid,
            &recipient.device_id,
            PreparedEndpointPayloadKind::MlsApplication,
            &payload_hash,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(recipient.clone()),
            payload_kind: PreparedEndpointPayloadKind::MlsApplication as i32,
            endpoint_payload: ciphertext,
            endpoint_payload_sha256: payload_hash,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![1; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        DeviceQueueItem {
            item_id: "item-1".to_string(),
            recipient: Some(recipient),
            lane_sequence: 1,
            event_id: "event-1".to_string(),
            conversation_id: "group-1".to_string(),
            idempotency_key: "event:event-1".to_string(),
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }

    fn welcome_queue_item(transition_id: &str, welcome_bytes: Vec<u8>) -> DeviceQueueItem {
        let recipient = CryptoEndpoint {
            ptid: "ptid:bob".to_string(),
            device_id: "bob-device".to_string(),
        };
        let welcome_hash = Sha256::digest(&welcome_bytes).to_vec();
        let mls_payload = MlsQueuePayload {
            kind: MlsQueuePayloadKind::Welcome as i32,
            conversation_id: "group-welcome".to_string(),
            transition_id: transition_id.to_string(),
            event_id: "welcome-event-1".to_string(),
            authority_sequence: 6,
            from_membership_epoch: 0,
            to_membership_epoch: 1,
            from_mls_epoch: 0,
            to_mls_epoch: 1,
            recipient: Some(recipient.clone()),
            opaque_mls_bytes: welcome_bytes,
            payload_sha256: welcome_hash,
        };
        let endpoint_payload = mls_payload.encode_to_vec();
        let endpoint_payload_hash = Sha256::digest(&endpoint_payload).to_vec();
        let mut event = ConversationEvent {
            event_id: "welcome-event-1".to_string(),
            conversation_id: "group-welcome".to_string(),
            sequence: 6,
            command_id: "welcome-command-1".to_string(),
            actor: Some(CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            }),
            previous_hash: vec![9; 32],
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 0,
                nanos: 100_000_000,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 1,
            authority_station_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MembershipTransitionCommitted(
                MembershipTransitionCommittedFact {
                    transition_id: transition_id.to_string(),
                    from_membership_epoch: 0,
                    to_membership_epoch: 1,
                    from_mls_epoch: 0,
                    to_mls_epoch: 1,
                    changes: vec![MessagingMembershipChangeCommitted {
                        action: MessagingMembershipAction::AddActor as i32,
                        ptid: "ptid:bob".to_string(),
                        device_id: "bob-device".to_string(),
                        home_station_id: "station-b".to_string(),
                        role: "member".to_string(),
                    }],
                    post_state: Some(authority_snapshot(1, 1)),
                    ..Default::default()
                },
            )),
        };
        let commitment = delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &recipient.ptid,
            &recipient.device_id,
            PreparedEndpointPayloadKind::MlsWelcome,
            &endpoint_payload_hash,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(recipient.clone()),
            payload_kind: PreparedEndpointPayloadKind::MlsWelcome as i32,
            endpoint_payload,
            endpoint_payload_sha256: endpoint_payload_hash,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![1; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        DeviceQueueItem {
            item_id: "welcome-item-1".to_string(),
            recipient: Some(recipient),
            lane_sequence: 1,
            event_id: "welcome-event-1".to_string(),
            conversation_id: "group-welcome".to_string(),
            idempotency_key: "event:welcome-event-1".to_string(),
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }

    fn commit_queue_item(
        conversation_id: &str,
        event_id: &str,
        item_id: &str,
        recipient_device_id: &str,
        transition_id: &str,
        commit_bytes: Vec<u8>,
        change: MessagingMembershipChangeCommitted,
    ) -> DeviceQueueItem {
        let recipient = CryptoEndpoint {
            ptid: "ptid:bob".to_string(),
            device_id: recipient_device_id.to_string(),
        };
        let commit_hash = Sha256::digest(&commit_bytes).to_vec();
        let mls_payload = MlsQueuePayload {
            kind: MlsQueuePayloadKind::Commit as i32,
            conversation_id: conversation_id.to_string(),
            transition_id: transition_id.to_string(),
            event_id: event_id.to_string(),
            authority_sequence: 1,
            from_membership_epoch: 1,
            to_membership_epoch: 2,
            from_mls_epoch: 1,
            to_mls_epoch: 2,
            recipient: Some(recipient.clone()),
            opaque_mls_bytes: commit_bytes,
            payload_sha256: commit_hash,
        };
        let endpoint_payload = mls_payload.encode_to_vec();
        let endpoint_payload_hash = Sha256::digest(&endpoint_payload).to_vec();
        let mut event = ConversationEvent {
            event_id: event_id.to_string(),
            conversation_id: conversation_id.to_string(),
            sequence: 1,
            command_id: "commit-command-1".to_string(),
            actor: Some(CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            }),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 0,
                nanos: 100_000_000,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 2,
            mls_epoch: 2,
            authority_station_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MembershipTransitionCommitted(
                MembershipTransitionCommittedFact {
                    transition_id: transition_id.to_string(),
                    from_membership_epoch: 1,
                    to_membership_epoch: 2,
                    from_mls_epoch: 1,
                    to_mls_epoch: 2,
                    changes: vec![change],
                    post_state: Some(authority_snapshot(2, 2)),
                    ..Default::default()
                },
            )),
        };
        let commitment = delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &recipient.ptid,
            &recipient.device_id,
            PreparedEndpointPayloadKind::MlsCommit,
            &endpoint_payload_hash,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(recipient.clone()),
            payload_kind: PreparedEndpointPayloadKind::MlsCommit as i32,
            endpoint_payload,
            endpoint_payload_sha256: endpoint_payload_hash,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![1; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        DeviceQueueItem {
            item_id: item_id.to_string(),
            recipient: Some(recipient),
            lane_sequence: 1,
            event_id: event_id.to_string(),
            conversation_id: conversation_id.to_string(),
            idempotency_key: format!("event:{event_id}"),
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }

    #[test]
    fn openmls_queue_consume_is_atomic_and_replay_skips_decrypt() {
        let alice = Arc::new(MlsGroupManager::new());
        let bob = Arc::new(MlsGroupManager::new());
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let bob_key_package = bob.generate_key_package().unwrap();
        let created = alice
            .create_group(
                "group-1",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob_key_package,
                }],
            )
            .unwrap();
        alice
            .accept_pending_transition("group-1", &created.transition_id)
            .unwrap();
        bob.join_group("group-1", &created.welcome_bytes).unwrap();
        let private_content =
            crate::messaging::encode_message_private_content("exact group plaintext", &[]).unwrap();
        let ciphertext = alice
            .encrypt_at_epoch("group-1", 1, &private_content)
            .unwrap()
            .ciphertext;
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .install_test_conversation_projection("group-1", 1, 1)
            .unwrap();
        store
            .save_mls_session_state(
                "group-1",
                &bob.export_session_state("group-1").unwrap(),
                1,
                1,
                90,
            )
            .unwrap();
        let processor = MlsApplicationProcessor::new(
            bob,
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:bob".to_string(),
                device_id: "bob-device".to_string(),
            },
            now,
        )
        .unwrap();
        let item = queue_item(ciphertext);
        processor.consume(&item, 1).unwrap();
        processor.consume(&item, 2).unwrap();

        let archive = store
            .build_recovery_archive("ptid:bob", [1; 32], 1)
            .unwrap();
        assert_eq!(archive.messages.len(), 1);
        assert_eq!(archive.messages[0].plaintext, "exact group plaintext");
    }

    #[test]
    fn openmls_welcome_queue_consume_is_atomic_and_replay_safe() {
        let alice = Arc::new(MlsGroupManager::new());
        let bob = Arc::new(MlsGroupManager::new());
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let bob_key_package = bob.generate_key_package().unwrap();
        let provider_pool = bob.export_pending_join_providers().unwrap();
        let created = alice
            .create_group(
                "group-welcome",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob_key_package,
                }],
            )
            .unwrap();
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .save_mls_join_provider_pool(&provider_pool, 90)
            .unwrap();
        let processor = MlsTransitionProcessor::new(
            bob.clone(),
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:bob".to_string(),
                device_id: "bob-device".to_string(),
            },
            now,
        )
        .unwrap();
        let item = welcome_queue_item(&created.transition_id, created.welcome_bytes.clone());
        processor.consume(&item, 1).unwrap();
        processor.consume(&item, 2).unwrap();
        assert!(bob.has_session("group-welcome"));
        assert!(store
            .load_mls_session_state("group-welcome")
            .unwrap()
            .is_some());
        assert_eq!(store.authority_head("group-welcome").unwrap().0, 6);
        assert_eq!(store.conversation_projections().unwrap().len(), 1);

        alice
            .accept_pending_transition("group-welcome", &created.transition_id)
            .unwrap();
        let ciphertext = alice
            .encrypt_at_epoch("group-welcome", 1, b"post-welcome plaintext")
            .unwrap()
            .ciphertext;
        assert_eq!(
            bob.prepare_application_message("group-welcome", &ciphertext)
                .unwrap()
                .plaintext,
            b"post-welcome plaintext"
        );
    }

    #[test]
    fn openmls_commit_queue_matches_authority_leaf_change_and_advances_epoch() {
        let alice = Arc::new(MlsGroupManager::new());
        let bob = Arc::new(MlsGroupManager::new());
        let charlie = Arc::new(MlsGroupManager::new());
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        charlie
            .actor_identity()
            .init("ptid:charlie", "charlie-device")
            .unwrap();
        let created = alice
            .create_group(
                "group-commit",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob.generate_key_package().unwrap(),
                }],
            )
            .unwrap();
        alice
            .accept_pending_transition("group-commit", &created.transition_id)
            .unwrap();
        bob.join_group("group-commit", &created.welcome_bytes)
            .unwrap();
        let prepared = alice
            .add_member(
                "group-commit",
                &MlsMemberKeyPackage {
                    ptid: "ptid:charlie".to_string(),
                    device_id: "charlie-device".to_string(),
                    key_package: charlie.generate_key_package().unwrap(),
                },
            )
            .unwrap();

        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .install_test_conversation_projection("group-commit", 1, 1)
            .unwrap();
        store
            .save_mls_session_state(
                "group-commit",
                &bob.export_session_state("group-commit").unwrap(),
                1,
                1,
                90,
            )
            .unwrap();
        let processor = MlsTransitionProcessor::new(
            bob.clone(),
            store,
            EngineEndpoint {
                ptid: "ptid:bob".to_string(),
                device_id: "bob-device".to_string(),
            },
            now,
        )
        .unwrap();
        processor
            .consume(
                &commit_queue_item(
                    "group-commit",
                    "commit-event-1",
                    "commit-item-1",
                    "bob-device",
                    &prepared.transition_id,
                    prepared.commit_bytes.clone(),
                    MessagingMembershipChangeCommitted {
                        action: MessagingMembershipAction::AddActor as i32,
                        ptid: "ptid:charlie".to_string(),
                        device_id: "charlie-device".to_string(),
                        home_station_id: "station-c".to_string(),
                        role: "member".to_string(),
                    },
                ),
                1,
            )
            .unwrap();
        assert_eq!(bob.group_epoch("group-commit").unwrap(), 2);

        alice
            .accept_pending_transition("group-commit", &prepared.transition_id)
            .unwrap();
        let ciphertext = alice
            .encrypt_at_epoch("group-commit", 2, b"post-commit plaintext")
            .unwrap()
            .ciphertext;
        assert_eq!(
            bob.prepare_application_message("group-commit", &ciphertext)
                .unwrap()
                .plaintext,
            b"post-commit plaintext"
        );
    }

    #[test]
    fn openmls_remove_device_commit_preserves_sibling_device_leaf() {
        let alice = Arc::new(MlsGroupManager::new());
        let bob_device_1 = Arc::new(MlsGroupManager::new());
        let bob_device_2 = Arc::new(MlsGroupManager::new());
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob_device_1
            .actor_identity()
            .init("ptid:bob", "bob-device-1")
            .unwrap();
        bob_device_2
            .actor_identity()
            .init("ptid:bob", "bob-device-2")
            .unwrap();
        let created = alice
            .create_group(
                "group-remove-device",
                &[
                    MlsMemberKeyPackage {
                        ptid: "ptid:bob".to_string(),
                        device_id: "bob-device-1".to_string(),
                        key_package: bob_device_1.generate_key_package().unwrap(),
                    },
                    MlsMemberKeyPackage {
                        ptid: "ptid:bob".to_string(),
                        device_id: "bob-device-2".to_string(),
                        key_package: bob_device_2.generate_key_package().unwrap(),
                    },
                ],
            )
            .unwrap();
        alice
            .accept_pending_transition("group-remove-device", &created.transition_id)
            .unwrap();
        bob_device_1
            .join_group("group-remove-device", &created.welcome_bytes)
            .unwrap();
        let removal = alice
            .remove_device("group-remove-device", "ptid:bob", "bob-device-2")
            .unwrap();

        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .install_test_conversation_projection("group-remove-device", 1, 1)
            .unwrap();
        store
            .save_mls_session_state(
                "group-remove-device",
                &bob_device_1
                    .export_session_state("group-remove-device")
                    .unwrap(),
                1,
                1,
                90,
            )
            .unwrap();
        let processor = MlsTransitionProcessor::new(
            bob_device_1.clone(),
            store,
            EngineEndpoint {
                ptid: "ptid:bob".to_string(),
                device_id: "bob-device-1".to_string(),
            },
            now,
        )
        .unwrap();
        processor
            .consume(
                &commit_queue_item(
                    "group-remove-device",
                    "remove-device-event-1",
                    "remove-device-item-1",
                    "bob-device-1",
                    &removal.transition_id,
                    removal.commit_bytes.clone(),
                    MessagingMembershipChangeCommitted {
                        action: MessagingMembershipAction::RemoveDevice as i32,
                        ptid: "ptid:bob".to_string(),
                        device_id: "bob-device-2".to_string(),
                        home_station_id: "station-b".to_string(),
                        role: "member".to_string(),
                    },
                ),
                1,
            )
            .unwrap();
        let head = bob_device_1.public_head("group-remove-device").unwrap();
        assert!(head
            .members
            .iter()
            .any(|member| member.ptid == "ptid:bob" && member.device_id == "bob-device-1"));
        assert!(!head
            .members
            .iter()
            .any(|member| member.device_id == "bob-device-2"));

        alice
            .accept_pending_transition("group-remove-device", &removal.transition_id)
            .unwrap();
        let ciphertext = alice
            .encrypt_at_epoch("group-remove-device", 2, b"after device revoke")
            .unwrap()
            .ciphertext;
        assert_eq!(
            bob_device_1
                .prepare_application_message("group-remove-device", &ciphertext)
                .unwrap()
                .plaintext,
            b"after device revoke"
        );
    }
}
