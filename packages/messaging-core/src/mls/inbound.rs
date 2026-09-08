use super::group::{MlsGroupManager, MlsPreparedReceive};
use crate::codec::private_content::decode_message_private_content;
use crate::codec::verification::verify_device_event_delivery;
use crate::contracts::{
    CryptoEndpoint, InteractionMutation, InteractionReceiveCommit, MlsApplicationReceiveCommit,
    MlsConversationMemberProjection, MlsConversationProjection, MlsMessageProjection,
    MlsRetirementReceiveCommit, MlsSenderTransitionReceiveCommit, MlsTransitionReceiveCommit,
    ReceiveCommitResult,
};
use crate::inbox::ClaimedItemConsumer;
use crate::proto::chat::{
    conversation_event, ConversationAuthoritySnapshot, ConversationEvent,
    CryptoEndpoint as ProtoCryptoEndpoint, DeviceConsumptionReceipt, DurableDeviceInboxItem,
    MemberRole, MembershipTransitionChange, MembershipTransitionCommittedFact,
    MessagingMembershipAction, MlsQueuePayload, MlsQueuePayloadKind, MlsRetirementMarker,
    PreparedEndpointPayloadKind, PublicEventMarker,
};
use crate::store::MlsInboundRepository;
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub struct MlsApplicationProcessor<R: MlsInboundRepository> {
    manager: Arc<MlsGroupManager>,
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: MlsInboundRepository> MlsApplicationProcessor<R> {
    pub fn new(
        manager: Arc<MlsGroupManager>,
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        validate_endpoint(
            &endpoint,
            "messaging MLS processor requires complete endpoint",
        )?;
        Ok(Self {
            manager,
            store,
            endpoint,
            clock,
        })
    }

    fn process(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        let now = (self.clock)();
        persist_claim(self.store.as_ref(), item, consumer_epoch, now)?;
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
        let committed_at_unix_ms = timestamp_millis(event, now);
        let receipt = consumption_receipt(item, event, &self.endpoint, now);
        let receipt_bytes = receipt.encode_to_vec();

        if is_edit {
            let result = self
                .store
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
                    mutation: InteractionMutation::Edit {
                        edited_text: &private_content.text,
                        edited_at_unix_ms: committed_at_unix_ms,
                    },
                    mls_session_state: Some(&prepared.session_state),
                    membership_epoch: event.membership_epoch,
                    mls_epoch: event.mls_epoch,
                    receipt_id: &receipt.receipt_id,
                    receipt_bytes: &receipt_bytes,
                    consumed_at_unix_ms: now,
                })?;
            if result == ReceiveCommitResult::Committed {
                self.manager
                    .install_prepared_application(&event.conversation_id, &prepared)?;
            }
            return Ok(());
        }

        let message = committed_fact
            .ok_or_else(|| "messaging MLS application has no message fact".to_string())?;
        let projection = MlsMessageProjection {
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
            reply_to_message_id: non_empty(&message.reply_to_message_id),
            thread_root_message_id: non_empty(&message.thread_root_message_id),
        };
        let result = self
            .store
            .commit_mls_application(&MlsApplicationReceiveCommit {
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
                receipt_id: &receipt.receipt_id,
                receipt_bytes: &receipt_bytes,
                consumed_at_unix_ms: now,
            })?;
        if result == ReceiveCommitResult::Committed {
            self.manager
                .install_prepared_application(&event.conversation_id, &prepared)?;
        }
        Ok(())
    }
}

impl<R: MlsInboundRepository> ClaimedItemConsumer for MlsApplicationProcessor<R> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

pub struct MlsTransitionProcessor<R: MlsInboundRepository> {
    manager: Arc<MlsGroupManager>,
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: MlsInboundRepository> MlsTransitionProcessor<R> {
    pub fn new(
        manager: Arc<MlsGroupManager>,
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        validate_endpoint(
            &endpoint,
            "messaging MLS transition processor requires complete endpoint",
        )?;
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

    fn process(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        let now = (self.clock)();
        persist_claim(self.store.as_ref(), item, consumer_epoch, now)?;
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
        let transition = transition_fact(event)?;
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
            || payload.recipient.as_ref() != Some(&proto_endpoint(&self.endpoint))
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
                actor_home_station_peer_id: change.home_station_peer_id.clone(),
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
        let result = self
            .store
            .commit_mls_transition_receive(&MlsTransitionReceiveCommit {
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
            })?;
        if result == ReceiveCommitResult::Committed {
            self.manager
                .install_received_state(&event.conversation_id, &prepared)?;
        }
        Ok(())
    }
}

impl<R: MlsInboundRepository> ClaimedItemConsumer for MlsTransitionProcessor<R> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

pub struct MlsSenderTransitionProcessor<R: MlsInboundRepository> {
    manager: Arc<MlsGroupManager>,
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: MlsInboundRepository> MlsSenderTransitionProcessor<R> {
    pub fn new(
        manager: Arc<MlsGroupManager>,
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        validate_endpoint(
            &endpoint,
            "messaging MLS sender processor requires endpoint",
        )?;
        Ok(Self {
            manager,
            store,
            endpoint,
            clock,
        })
    }

    fn process(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        let now = (self.clock)();
        persist_claim(self.store.as_ref(), item, consumer_epoch, now)?;
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
        let transition = transition_fact(event)?;
        let marker = PublicEventMarker::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging MLS sender marker is invalid".to_string())?;
        if marker.conversation_id != event.conversation_id
            || marker.event_id != event.event_id
            || marker.command_id != event.command_id
            || marker.sending_endpoint.as_ref() != Some(&proto_endpoint(&self.endpoint))
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
        let receipt = consumption_receipt(item, event, &self.endpoint, now);
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

impl<R: MlsInboundRepository> ClaimedItemConsumer for MlsSenderTransitionProcessor<R> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

pub struct MlsRetirementProcessor<R: MlsInboundRepository> {
    manager: Arc<MlsGroupManager>,
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    clock: fn() -> i64,
}

impl<R: MlsInboundRepository> MlsRetirementProcessor<R> {
    pub fn new(
        manager: Arc<MlsGroupManager>,
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        validate_endpoint(
            &endpoint,
            "messaging MLS retirement processor requires endpoint",
        )?;
        Ok(Self {
            manager,
            store,
            endpoint,
            clock,
        })
    }

    fn process(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        let now = (self.clock)();
        persist_claim(self.store.as_ref(), item, consumer_epoch, now)?;
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
        let transition = transition_fact(event)?;
        let marker = MlsRetirementMarker::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging MLS retirement marker is invalid".to_string())?;
        let local_endpoint = proto_endpoint(&self.endpoint);
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
        let receipt = consumption_receipt(item, event, &self.endpoint, now);
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

impl<R: MlsInboundRepository> ClaimedItemConsumer for MlsRetirementProcessor<R> {
    fn consume(&self, item: &DurableDeviceInboxItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

pub fn validate_authority_snapshot(
    event: &ConversationEvent,
    snapshot: Option<&ConversationAuthoritySnapshot>,
) -> Result<(), String> {
    let snapshot =
        snapshot.ok_or_else(|| "messaging MLS transition has no authority snapshot".to_string())?;
    if snapshot.kind != crate::proto::chat::ConversationKind::Group as i32
        || snapshot.federation_id.trim().is_empty()
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
        let role = authority_member_role(&member.role)?;
        if member.ptid.trim().is_empty()
            || previous_member.is_some_and(|value: &str| value >= member.ptid.as_str())
            || (member.ptid == snapshot.owner_ptid) != (role == MemberRole::Owner)
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

pub fn authority_snapshot_projection(
    event: &ConversationEvent,
    snapshot: &ConversationAuthoritySnapshot,
    now: i64,
) -> Result<MlsConversationProjection, String> {
    validate_authority_snapshot(event, Some(snapshot))?;
    Ok(MlsConversationProjection {
        conversation_id: event.conversation_id.clone(),
        authority_station_id: event.authority_station_peer_id.clone(),
        federation_id: snapshot.federation_id.clone(),
        kind: snapshot.kind,
        name: snapshot.name.clone(),
        owner_ptid: snapshot.owner_ptid.clone(),
        members: snapshot
            .active_members
            .iter()
            .map(|member| {
                Ok(MlsConversationMemberProjection {
                    ptid: member.ptid.clone(),
                    role: authority_member_role(&member.role)? as i32,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
        membership_epoch: snapshot.membership_epoch,
        mls_epoch: snapshot.mls_epoch,
        active: true,
        updated_at_unix_ms: now,
    })
}

fn join_checkpoint_projection(
    event: &ConversationEvent,
    transition: &MembershipTransitionCommittedFact,
    endpoint: &CryptoEndpoint,
    now: i64,
) -> Result<MlsConversationProjection, String> {
    let snapshot = transition
        .post_state
        .as_ref()
        .ok_or_else(|| "messaging MLS transition has no authority snapshot".to_string())?;
    validate_authority_snapshot(event, Some(snapshot))?;
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

fn authority_member_role(role: &str) -> Result<MemberRole, String> {
    match role {
        "member" | "MEMBER_ROLE_MEMBER" => Ok(MemberRole::Member),
        "admin" | "MEMBER_ROLE_ADMIN" => Ok(MemberRole::Admin),
        "owner" | "MEMBER_ROLE_OWNER" => Ok(MemberRole::Owner),
        _ => Err("messaging MLS authority member role is invalid".to_string()),
    }
}

fn transition_fact(
    event: &ConversationEvent,
) -> Result<&MembershipTransitionCommittedFact, String> {
    match event.payload.as_ref() {
        Some(conversation_event::Payload::MembershipTransitionCommitted(transition)) => {
            Ok(transition)
        }
        _ => Err("messaging MLS delivery has no transition fact".to_string()),
    }
}

fn persist_claim<R: MlsInboundRepository>(
    store: &R,
    item: &DurableDeviceInboxItem,
    consumer_epoch: u64,
    now: i64,
) -> Result<(), String> {
    store.persist_claimed_item(
        &item.item_id,
        &item.event_id,
        &item.conversation_id,
        item.lane_sequence,
        consumer_epoch,
        &item.payload_sha256,
        &item.opaque_payload,
        now,
    )
}

fn consumption_receipt(
    item: &DurableDeviceInboxItem,
    event: &ConversationEvent,
    endpoint: &CryptoEndpoint,
    now: i64,
) -> DeviceConsumptionReceipt {
    DeviceConsumptionReceipt {
        receipt_id: format!("device-consumed:{}", item.item_id),
        conversation_id: event.conversation_id.clone(),
        event_id: event.event_id.clone(),
        consumer: Some(proto_endpoint(endpoint)),
        event_sequence: event.sequence,
        lane_sequence: item.lane_sequence,
        payload_sha256: item.payload_sha256.clone(),
        consumed_at: Some(prost_types::Timestamp {
            seconds: now.div_euclid(1_000),
            nanos: (now.rem_euclid(1_000) * 1_000_000) as i32,
        }),
    }
}

fn proto_endpoint(endpoint: &CryptoEndpoint) -> ProtoCryptoEndpoint {
    ProtoCryptoEndpoint {
        ptid: endpoint.ptid.clone(),
        device_id: endpoint.device_id.clone(),
    }
}

fn validate_endpoint(endpoint: &CryptoEndpoint, error: &str) -> Result<(), String> {
    if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
        return Err(error.to_string());
    }
    Ok(())
}

fn timestamp_millis(event: &ConversationEvent, fallback: i64) -> i64 {
    event
        .committed_at
        .as_ref()
        .map(|timestamp| {
            timestamp
                .seconds
                .saturating_mul(1_000)
                .saturating_add(i64::from(timestamp.nanos) / 1_000_000)
        })
        .unwrap_or(fallback)
}

fn non_empty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::private_content::encode_message_private_content;
    use crate::codec::verification::delivery_commitment;
    use crate::inbox::ClaimedItemConsumer;
    use crate::mls::group::MlsMemberKeyPackage;
    use crate::mls::group_genesis::GroupGenesisPreparer;
    use crate::mls::test_support::TestMlsRepository;
    use crate::proto::chat::{
        chat_command, ConversationAuthorityMember, ConversationKind, DeviceEventDelivery,
        DeviceInboxPayloadType, MembershipTransitionCommittedFact, MessageCommittedFact,
        MessagingContentKind, MessagingMembershipChangeCommitted, PrepareConversationGroupResponse,
    };
    use crate::proto::key_exchange::MlsKeyPackageReservation;
    use crate::proto::{actor_device_from_chat_endpoint, actor_device_ref};

    fn now() -> i64 {
        100
    }

    fn endpoint(ptid: &str, device_id: &str) -> CryptoEndpoint {
        CryptoEndpoint {
            ptid: ptid.to_string(),
            device_id: device_id.to_string(),
        }
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
                    home_station_peer_id: "station-local".to_string(),
                },
                ConversationAuthorityMember {
                    ptid: "ptid:bob".to_string(),
                    role: "member".to_string(),
                    home_station_peer_id: "station-remote".to_string(),
                },
            ],
            active_endpoints: vec![
                proto_endpoint(&endpoint("ptid:alice", "alice-device")),
                proto_endpoint(&endpoint("ptid:bob", "bob-device")),
            ],
            federation_id: "federation-1".to_string(),
            membership_epoch,
            mls_epoch,
            ..Default::default()
        }
    }

    fn queue_item(ciphertext: Vec<u8>) -> DurableDeviceInboxItem {
        let recipient = proto_endpoint(&endpoint("ptid:bob", "bob-device"));
        let payload_hash = Sha256::digest(&ciphertext).to_vec();
        let mut event = ConversationEvent {
            event_id: "event-1".to_string(),
            conversation_id: "group-1".to_string(),
            sequence: 1,
            command_id: "command-1".to_string(),
            actor: Some(proto_endpoint(&endpoint("ptid:alice", "alice-device"))),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 0,
                nanos: 100_000_000,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 1,
            authority_station_peer_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MessageCommitted(
                MessageCommittedFact {
                    message_id: "message-1".to_string(),
                    sender: Some(proto_endpoint(&endpoint("ptid:alice", "alice-device"))),
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
        DurableDeviceInboxItem {
            item_id: "item-1".to_string(),
            recipient: Some(actor_device_from_chat_endpoint(&recipient)),
            lane_sequence: 1,
            event_id: "event-1".to_string(),
            conversation_id: "group-1".to_string(),
            idempotency_key: "event:event-1".to_string(),
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }

    fn welcome_queue_item(transition_id: &str, welcome_bytes: Vec<u8>) -> DurableDeviceInboxItem {
        let recipient = proto_endpoint(&endpoint("ptid:bob", "bob-device"));
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
            actor: Some(proto_endpoint(&endpoint("ptid:alice", "alice-device"))),
            previous_hash: vec![9; 32],
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 0,
                nanos: 100_000_000,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 1,
            authority_station_peer_id: "station-local".to_string(),
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
                        home_station_peer_id: "station-b".to_string(),
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
        DurableDeviceInboxItem {
            item_id: "welcome-item-1".to_string(),
            recipient: Some(actor_device_from_chat_endpoint(&recipient)),
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
    ) -> DurableDeviceInboxItem {
        let recipient = proto_endpoint(&endpoint("ptid:bob", recipient_device_id));
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
            actor: Some(proto_endpoint(&endpoint("ptid:alice", "alice-device"))),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 0,
                nanos: 100_000_000,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 2,
            mls_epoch: 2,
            authority_station_peer_id: "station-local".to_string(),
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
        DurableDeviceInboxItem {
            item_id: item_id.to_string(),
            recipient: Some(actor_device_from_chat_endpoint(&recipient)),
            lane_sequence: 1,
            event_id: event_id.to_string(),
            conversation_id: conversation_id.to_string(),
            idempotency_key: format!("event:{event_id}"),
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }

    fn retirement_item() -> DurableDeviceInboxItem {
        let local = proto_endpoint(&endpoint("ptid:carol", "carol-device-2"));
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
            actor: Some(proto_endpoint(&endpoint("ptid:alice", "alice-device"))),
            previous_hash: vec![7; 32],
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 12,
                nanos: 0,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 7,
            mls_epoch: 7,
            authority_station_peer_id: "station-local".to_string(),
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
                        kind: ConversationKind::Group as i32,
                        name: "group".to_string(),
                        owner_ptid: "ptid:alice".to_string(),
                        active_members: vec![
                            ConversationAuthorityMember {
                                ptid: "ptid:alice".to_string(),
                                role: "owner".to_string(),
                                home_station_peer_id: "station-local".to_string(),
                            },
                            ConversationAuthorityMember {
                                ptid: "ptid:carol".to_string(),
                                role: "member".to_string(),
                                home_station_peer_id: "station-c".to_string(),
                            },
                        ],
                        active_endpoints: vec![
                            proto_endpoint(&endpoint("ptid:alice", "alice-device")),
                            proto_endpoint(&endpoint("ptid:carol", "carol-device-1")),
                        ],
                        federation_id: "federation-1".to_string(),
                        membership_epoch: 7,
                        mls_epoch: 7,
                        ..Default::default()
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
        DurableDeviceInboxItem {
            item_id: "item-12".to_string(),
            recipient: delivery
                .recipient
                .as_ref()
                .map(actor_device_from_chat_endpoint),
            lane_sequence: 1,
            event_id: "event-12".to_string(),
            conversation_id: "group-1".to_string(),
            idempotency_key: "event:event-12".to_string(),
            payload_type: DeviceInboxPayloadType::ConversationEvent as i32,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }

    #[test]
    fn authority_snapshot_projection_preserves_member_roles() {
        let mut snapshot = authority_snapshot(3, 4);
        snapshot.active_members[1].role = "admin".to_string();
        let event = ConversationEvent {
            conversation_id: "group-role-projection".to_string(),
            authority_station_peer_id: "station-local".to_string(),
            membership_epoch: 3,
            mls_epoch: 4,
            ..Default::default()
        };

        let projection = authority_snapshot_projection(&event, &snapshot, 100).unwrap();

        assert_eq!(projection.federation_id, "federation-1");
        assert_eq!(
            projection
                .members
                .iter()
                .map(|member| (member.ptid.as_str(), member.role))
                .collect::<Vec<_>>(),
            vec![
                ("ptid:alice", MemberRole::Owner as i32),
                ("ptid:bob", MemberRole::Admin as i32),
            ]
        );
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
        let private_content = encode_message_private_content("exact group plaintext", &[]).unwrap();
        let ciphertext = alice
            .encrypt_at_epoch("group-1", 1, &private_content)
            .unwrap()
            .ciphertext;
        let store = Arc::new(TestMlsRepository::new(0, Vec::new()));
        store.install_conversation("group-1", 1, 1);
        store.save_mls_session_state("group-1", bob.export_session_state("group-1").unwrap());
        let processor = MlsApplicationProcessor::new(
            bob,
            store.clone(),
            endpoint("ptid:bob", "bob-device"),
            now,
        )
        .unwrap();
        let item = queue_item(ciphertext);

        processor.consume(&item, 1).unwrap();
        processor.consume(&item, 2).unwrap();

        let messages = store.messages();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].plaintext, "exact group plaintext");
    }

    #[test]
    fn openmls_welcome_queue_consume_is_atomic_restart_replay_safe_and_fork_protected() {
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
        let store = Arc::new(TestMlsRepository::new(0, Vec::new()));
        store.save_mls_join_provider_pool(provider_pool);
        let processor = MlsTransitionProcessor::new(
            bob.clone(),
            store.clone(),
            endpoint("ptid:bob", "bob-device"),
            now,
        )
        .unwrap();
        let item = welcome_queue_item(&created.transition_id, created.welcome_bytes.clone());

        let mut mismatched_item = item.clone();
        mismatched_item.item_id = "welcome-item-mismatch".to_string();
        let mut mismatched_delivery =
            DeviceEventDelivery::decode(mismatched_item.opaque_payload.as_slice()).unwrap();
        let mismatched_event = mismatched_delivery.event.as_mut().unwrap();
        mismatched_event.sequence += 1;
        mismatched_event.event_hash.clear();
        mismatched_event.event_hash = Sha256::digest(mismatched_event.encode_to_vec()).to_vec();
        mismatched_item.opaque_payload = mismatched_delivery.encode_to_vec();
        mismatched_item.payload_sha256 = Sha256::digest(&mismatched_item.opaque_payload).to_vec();
        assert_eq!(
            processor.consume(&mismatched_item, 1).unwrap_err(),
            "messaging MLS transition binding mismatch"
        );
        assert!(!bob.has_session("group-welcome"));
        assert!(store.mls_session_state("group-welcome").is_none());

        processor.consume(&item, 1).unwrap();

        assert!(bob.has_session("group-welcome"));
        assert!(store.mls_session_state("group-welcome").is_some());
        assert_eq!(
            MlsInboundRepository::authority_head(store.as_ref(), "group-welcome")
                .unwrap()
                .0,
            6
        );
        assert_eq!(store.conversations().len(), 1);

        let restarted_bob = Arc::new(MlsGroupManager::new());
        restarted_bob
            .actor_identity()
            .init("ptid:bob", "bob-device")
            .unwrap();
        let restarted_processor = MlsTransitionProcessor::new(
            restarted_bob.clone(),
            store.clone(),
            endpoint("ptid:bob", "bob-device"),
            now,
        )
        .unwrap();
        restarted_processor.consume(&item, 2).unwrap();
        assert!(restarted_bob.has_session("group-welcome"));
        assert_eq!(store.conversations().len(), 1);

        let mut conflicting_replay = item.clone();
        let mut conflicting_delivery =
            DeviceEventDelivery::decode(conflicting_replay.opaque_payload.as_slice()).unwrap();
        let conflicting_event = conflicting_delivery.event.as_mut().unwrap();
        conflicting_event.command_id = "forked-command".to_string();
        conflicting_event.event_hash.clear();
        conflicting_event.event_hash = Sha256::digest(conflicting_event.encode_to_vec()).to_vec();
        conflicting_replay.opaque_payload = conflicting_delivery.encode_to_vec();
        conflicting_replay.payload_sha256 =
            Sha256::digest(&conflicting_replay.opaque_payload).to_vec();
        assert_eq!(
            restarted_processor
                .consume(&conflicting_replay, 3)
                .unwrap_err(),
            "test claimed item payload hash mismatch"
        );

        alice
            .accept_pending_transition("group-welcome", &created.transition_id)
            .unwrap();
        let ciphertext = alice
            .encrypt_at_epoch("group-welcome", 1, b"post-welcome plaintext")
            .unwrap()
            .ciphertext;
        assert_eq!(
            restarted_bob
                .prepare_application_message("group-welcome", &ciphertext)
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
        let store = Arc::new(TestMlsRepository::new(0, Vec::new()));
        store.install_conversation("group-commit", 1, 1);
        store.save_mls_session_state(
            "group-commit",
            bob.export_session_state("group-commit").unwrap(),
        );
        let processor = MlsTransitionProcessor::new(
            bob.clone(),
            store,
            endpoint("ptid:bob", "bob-device"),
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
                        home_station_peer_id: "station-c".to_string(),
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
        let store = Arc::new(TestMlsRepository::new(0, Vec::new()));
        store.install_conversation("group-remove-device", 1, 1);
        store.save_mls_session_state(
            "group-remove-device",
            bob_device_1
                .export_session_state("group-remove-device")
                .unwrap(),
        );
        let processor = MlsTransitionProcessor::new(
            bob_device_1.clone(),
            store,
            endpoint("ptid:bob", "bob-device-1"),
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
                        home_station_peer_id: "station-b".to_string(),
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

    #[test]
    fn sender_marker_commits_prepared_genesis_before_installing_live_session() {
        let store = Arc::new(TestMlsRepository::new(1, vec![7; 32]));
        store.install_conversation("group-1", 0, 0);
        store.install_authority_head("group-1", 1, vec![7; 32]);
        let alice = Arc::new(MlsGroupManager::new());
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let local_endpoint = endpoint("ptid:alice", "alice-device");
        let bob_key_package = bob.generate_key_package().unwrap();
        let plan = PrepareConversationGroupResponse {
            authority_plan_id: "plan-1".to_string(),
            expires_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            authority_station_peer_id: "station-local".to_string(),
            prospective_endpoints: vec![
                actor_device_ref(&local_endpoint.ptid, &local_endpoint.device_id),
                actor_device_ref("ptid:bob", "bob-device"),
            ],
            reserved_key_packages: vec![MlsKeyPackageReservation {
                target: Some(actor_device_ref("ptid:bob", "bob-device")),
                package_id: "package-1".to_string(),
                key_package_sha256: Sha256::digest(&bob_key_package).to_vec(),
                key_package: bob_key_package,
            }],
            endpoint_manifests: Vec::new(),
            authority_plan_sha256: vec![8; 32],
        };
        let command = GroupGenesisPreparer::new(
            store.clone(),
            alice.clone(),
            proto_endpoint(&local_endpoint),
        )
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
            sending_endpoint: Some(proto_endpoint(&local_endpoint)),
        };
        let endpoint_payload = marker.encode_to_vec();
        let endpoint_payload_sha256 = Sha256::digest(&endpoint_payload).to_vec();
        let mut event = ConversationEvent {
            event_id: "event-2".to_string(),
            conversation_id: "group-1".to_string(),
            sequence: 2,
            command_id: command.command_id.clone(),
            actor: Some(proto_endpoint(&local_endpoint)),
            previous_hash: vec![7; 32],
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 1,
            authority_station_peer_id: "station-local".to_string(),
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
                            home_station_peer_id: if change.ptid == local_endpoint.ptid {
                                "station-local"
                            } else {
                                "station-remote"
                            }
                            .to_string(),
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
            &local_endpoint.ptid,
            &local_endpoint.device_id,
            PreparedEndpointPayloadKind::PublicEvent,
            &endpoint_payload_sha256,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(proto_endpoint(&local_endpoint)),
            payload_kind: PreparedEndpointPayloadKind::PublicEvent as i32,
            endpoint_payload,
            endpoint_payload_sha256,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![1; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        let item = DurableDeviceInboxItem {
            item_id: "item-2".to_string(),
            recipient: Some(actor_device_ref(
                &local_endpoint.ptid,
                &local_endpoint.device_id,
            )),
            lane_sequence: 1,
            event_id: "event-2".to_string(),
            conversation_id: "group-1".to_string(),
            idempotency_key: "event:event-2".to_string(),
            payload_type: DeviceInboxPayloadType::ConversationEvent as i32,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        };
        let processor =
            MlsSenderTransitionProcessor::new(alice.clone(), store.clone(), local_endpoint, now)
                .unwrap();

        processor.consume(&item, 1).unwrap();

        assert!(alice.has_session("group-1"));
        assert!(
            MlsInboundRepository::pending_mls_transition(store.as_ref(), "group-1")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            MlsInboundRepository::authority_head(store.as_ref(), "group-1")
                .unwrap()
                .0,
            2
        );
        assert_eq!(store.conversations()[0].mls_epoch, 1);
    }

    #[test]
    fn retirement_atomically_removes_live_mls_state_and_is_replay_safe() {
        let store = Arc::new(TestMlsRepository::new(0, Vec::new()));
        store.install_conversation("group-1", 6, 6);
        store.install_authority_head("group-1", 11, vec![7; 32]);
        store.save_mls_session_state("group-1", b"live-session".to_vec());
        let manager = Arc::new(MlsGroupManager::new());
        let processor = MlsRetirementProcessor::new(
            manager,
            store.clone(),
            endpoint("ptid:carol", "carol-device-2"),
            now,
        )
        .unwrap();
        let item = retirement_item();

        processor.consume(&item, 1).unwrap();
        processor.consume(&item, 2).unwrap();

        assert!(store.mls_session_state("group-1").is_none());
        assert!(store.has_retired_checkpoint("group-1"));
        assert_eq!(
            MlsInboundRepository::authority_head(store.as_ref(), "group-1")
                .unwrap()
                .0,
            12
        );
        let projection = store.conversations().remove(0);
        assert_eq!(projection.membership_epoch, 7);
        assert_eq!(projection.mls_epoch, 7);
        assert!(projection.active);
    }
}
