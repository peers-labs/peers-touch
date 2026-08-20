use super::{
    decode_message_private_content, verify_device_event_delivery, ClaimedItemConsumer,
    DirectEditCommit, DirectReceiveCommit, EngineEndpoint, MessageProjection, MessagingStore,
    ReceiveCommitResult,
};
use crate::domain::crypto::double_ratchet::{self, DrCiphertextWire};
use crate::domain::crypto::{
    CryptoEndpoint as SessionEndpoint, DirectSessionKey, IdentityKeyPair, SessionManager,
    X25519KeyPair, X3dhReceiverInput,
};
use crate::model::chat::{
    conversation_event, CryptoEndpoint, DeviceConsumptionReceipt, DeviceQueueItem,
    DeviceQueuePayloadType, DirectCiphertextAad, DirectDeviceCiphertext, DirectSessionInit,
    MessageReceipt, MessagingContentKind, PreparedEndpointPayloadKind, ReceiptType,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub struct DirectMessageProcessor {
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
    actor_identity: Option<Arc<IdentityKeyPair>>,
    clock: fn() -> i64,
}

impl DirectMessageProcessor {
    pub fn new(
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        Self::with_optional_actor_identity(store, endpoint, None, clock)
    }

    pub fn with_actor_identity(
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        actor_identity: Arc<IdentityKeyPair>,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        Self::with_optional_actor_identity(store, endpoint, Some(actor_identity), clock)
    }

    fn with_optional_actor_identity(
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        actor_identity: Option<Arc<IdentityKeyPair>>,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging Direct processor requires complete endpoint".to_string());
        }
        Ok(Self {
            store,
            endpoint,
            actor_identity,
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
        if DeviceQueuePayloadType::try_from(item.payload_type)
            .map_err(|_| "messaging Direct queue payload type is invalid".to_string())?
            != DeviceQueuePayloadType::ConversationEvent
        {
            return Err("messaging Direct processor received wrong queue payload type".to_string());
        }

        let delivery =
            verify_device_event_delivery(item, &self.endpoint.ptid, &self.endpoint.device_id)?;
        if PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "messaging Direct payload kind is invalid".to_string())?
            != PreparedEndpointPayloadKind::DirectCiphertext
        {
            return Err("messaging Direct processor received non-Direct payload".to_string());
        }
        let event = delivery
            .event
            .as_ref()
            .ok_or_else(|| "messaging Direct delivery has no event".to_string())?;
        let (message_id, is_edit, committed_fact) = match event.payload.as_ref() {
            Some(conversation_event::Payload::MessageCommitted(message)) => {
                if MessagingContentKind::try_from(message.content_kind)
                    .map_err(|_| "messaging Direct content kind is invalid".to_string())?
                    != MessagingContentKind::Text
                {
                    return Err(
                        "messaging Direct processor only accepts text projections".to_string()
                    );
                }
                (message.message_id.as_str(), false, Some(message))
            }
            Some(conversation_event::Payload::MessageEdited(fact)) => {
                if fact.message_id.trim().is_empty() {
                    return Err("messaging Direct edit has no message ID".to_string());
                }
                (fact.message_id.as_str(), true, None)
            }
            _ => return Err("messaging Direct delivery has unsupported event type".to_string()),
        };
        let direct = DirectDeviceCiphertext::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "messaging Direct ciphertext payload is invalid".to_string())?;
        if let Some(init) = direct.session_init.as_ref() {
            if delivery.sender_actor_identity_public_key.len() != 32
                || init.sender_identity_key != delivery.sender_actor_identity_public_key
            {
                return Err("messaging Direct sender identity is not authority-bound".to_string());
            }
        }
        // Binding validation uses the full MessageCommittedFact; skip for edits
        // which carry only a MessageEditedFact without sender/message_id bindings.
        if let Some(message) = committed_fact {
            validate_direct_bindings(event, message, &direct, &self.endpoint)?;
        }

        let ratchet = direct
            .ratchet_ciphertext
            .as_ref()
            .ok_or_else(|| "messaging Direct ratchet ciphertext is missing".to_string())?;
        let ratchet_bytes = ratchet.encode_to_vec();
        if direct.ciphertext_sha256.len() != 32
            || Sha256::digest(&ratchet_bytes).as_slice() != direct.ciphertext_sha256
        {
            return Err("messaging Direct ciphertext hash mismatch".to_string());
        }
        let wire = DrCiphertextWire {
            version: ratchet.wire_version,
            sender_dh: fixed_bytes(
                "sender ratchet public key",
                &ratchet.sender_ratchet_public_key,
            )?,
            n_send: ratchet.message_counter,
            n_prev: ratchet.previous_chain_length,
            nonce: fixed_bytes("Direct ciphertext nonce", &ratchet.nonce)?,
            ciphertext: ratchet.ciphertext.clone(),
        };
        if wire.ciphertext.is_empty() {
            return Err("messaging Direct ciphertext is empty".to_string());
        }

        let (mut session, consumed_one_time_prekey_id) =
            match self.store.load_direct_session(&direct.session_id)? {
                Some(session) => {
                    if let Some(init) = direct.session_init.as_ref() {
                        validate_session_init(&direct, init, &self.endpoint)?;
                        if init.sender_identity_key != session.peer_identity_key {
                            return Err("messaging Direct repeated session init identity mismatch"
                                .to_string());
                        }
                    }
                    (session, None)
                }
                None => self.prepare_receiver_session(&direct, now)?,
            };
        validate_session_binding(&session, event, &direct, &self.endpoint)?;
        let skipped = self.store.load_direct_skipped_keys(&direct.session_id)?;
        let aad = encode_direct_ciphertext_aad(event.conversation_id.as_str(), &direct);
        let outcome = double_ratchet::decrypt(&session.ratchet, &wire, &skipped, &aad)
            .map_err(|error| format!("messaging Direct decrypt failed: {error}"))?;
        let private_content = decode_message_private_content(&outcome.plaintext)?;
        session.ratchet = outcome.advanced_state;
        session.updated_at_unix_ms = now;

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
        let delivery_receipt = MessageReceipt {
            conversation_id: event.conversation_id.clone(),
            message_id: message_id.to_string(),
            ptid: self.endpoint.ptid.clone(),
            device_id: self.endpoint.device_id.clone(),
            receipt_type: ReceiptType::Delivered as i32,
            ts: Some(prost_types::Timestamp {
                seconds: now.div_euclid(1_000),
                nanos: (now.rem_euclid(1_000) * 1_000_000) as i32,
            }),
        };
        let delivery_receipt_id = format!(
            "message-delivered:{}:{}",
            event.event_id, self.endpoint.device_id
        );
        let delivery_receipt_bytes = delivery_receipt.encode_to_vec();

        if is_edit {
            // Edit path: decrypt succeeded, apply the edit to the existing
            // projection and persist session state atomically.
            let input = DirectEditCommit {
                item_id: &item.item_id,
                event_id: &event.event_id,
                conversation_id: &event.conversation_id,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                event_hash: &event.event_hash,
                previous_event_hash: &event.previous_hash,
                event_sequence: event.sequence,
                session: &session,
                new_skipped: &outcome.new_skipped,
                consumed_skipped: outcome.consumed_skipped,
                consumed_one_time_prekey_id,
                message_id,
                edited_text: &private_content.text,
                edited_at_unix_ms: committed_at_unix_ms,
                receipt_id: &receipt.receipt_id,
                receipt_bytes: &receipt_bytes,
                delivery_receipt_id: &delivery_receipt_id,
                delivery_receipt_bytes: &delivery_receipt_bytes,
                consumed_at_unix_ms: now,
            };
            if self.store.commit_direct_edit(&input)? == ReceiveCommitResult::Committed {
                crate::domain::crypto::telemetry::record_dr_decrypt();
            }
        } else {
            // New message path: build full projection and commit.
            let reply_to = committed_fact.and_then(|fact| {
                if fact.reply_to_message_id.is_empty() {
                    None
                } else {
                    Some(fact.reply_to_message_id.clone())
                }
            });
            let thread_root = committed_fact.and_then(|fact| {
                if fact.thread_root_message_id.is_empty() {
                    None
                } else {
                    Some(fact.thread_root_message_id.clone())
                }
            });
            let projection = MessageProjection {
                conversation_id: event.conversation_id.clone(),
                event_id: event.event_id.clone(),
                event_sequence: event.sequence,
                message_id: message_id.to_string(),
                sender_ptid: direct
                    .sender
                    .as_ref()
                    .map(|endpoint| endpoint.ptid.clone())
                    .unwrap_or_default(),
                sender_device_id: direct
                    .sender
                    .as_ref()
                    .map(|endpoint| endpoint.device_id.clone())
                    .unwrap_or_default(),
                plaintext: private_content.text,
                attachments: private_content.attachments,
                committed_at_unix_ms,
                reply_to_message_id: reply_to,
                thread_root_message_id: thread_root,
                edited_text: None,
                edited_at_unix_ms: None,
                retracted: false,
            };
            let input = DirectReceiveCommit {
                item_id: &item.item_id,
                event_id: &event.event_id,
                conversation_id: &event.conversation_id,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                event_hash: &event.event_hash,
                previous_event_hash: &event.previous_hash,
                session: &session,
                new_skipped: &outcome.new_skipped,
                consumed_skipped: outcome.consumed_skipped,
                consumed_one_time_prekey_id,
                projection: &projection,
                reply_to_message_id: projection.reply_to_message_id.as_deref(),
                thread_root_message_id: projection.thread_root_message_id.as_deref(),
                receipt_id: &receipt.receipt_id,
                receipt_bytes: &receipt_bytes,
                delivery_receipt_id: &delivery_receipt_id,
                delivery_receipt_bytes: &delivery_receipt_bytes,
                consumed_at_unix_ms: now,
            };
            if self.store.commit_direct_receive(&input)? == ReceiveCommitResult::Committed {
                crate::domain::crypto::telemetry::record_dr_decrypt();
            }
        }
        Ok(())
    }

    fn prepare_receiver_session(
        &self,
        direct: &DirectDeviceCiphertext,
        now_unix_ms: i64,
    ) -> Result<(crate::domain::crypto::DirectSession, Option<i32>), String> {
        let init = direct
            .session_init
            .as_ref()
            .ok_or_else(|| "messaging Direct session is unavailable".to_string())?;
        validate_session_init(direct, init, &self.endpoint)?;
        let actor_identity = self.actor_identity.as_ref().ok_or_else(|| {
            "messaging Direct session initialization requires actor identity".to_string()
        })?;
        let signed_prekey_id = i32::try_from(init.recipient_signed_prekey_id)
            .map_err(|_| "messaging Direct signed prekey ID is invalid".to_string())?;
        let signed_prekey =
            X25519KeyPair::from_private_bytes(self.store.load_signed_prekey(signed_prekey_id)?);
        let (one_time_prekey, consumed_one_time_prekey_id) = match init.recipient_one_time_prekey_id
        {
            Some(id) => {
                let id = i32::try_from(id)
                    .map_err(|_| "messaging Direct one-time prekey ID is invalid".to_string())?;
                (
                    Some(X25519KeyPair::from_private_bytes(
                        self.store.load_one_time_prekey(id)?,
                    )),
                    Some(id),
                )
            }
            None => (None, None),
        };
        let sender = direct
            .sender
            .as_ref()
            .ok_or_else(|| "messaging Direct sender is missing".to_string())?;
        let local =
            SessionEndpoint::new(self.endpoint.ptid.clone(), self.endpoint.device_id.clone())
                .map_err(|error| error.to_string())?;
        let peer = SessionEndpoint::new(sender.ptid.clone(), sender.device_id.clone())
            .map_err(|error| error.to_string())?;
        let session = SessionManager::establish_receiver_session(
            direct.session_id.clone(),
            DirectSessionKey::new(
                init.conversation_id.clone(),
                local,
                peer,
                init.session_generation,
            )
            .map_err(|error| error.to_string())?,
            init.protocol_version,
            actor_identity,
            &signed_prekey,
            one_time_prekey.as_ref(),
            &X3dhReceiverInput {
                sender_ik_pub: fixed_bytes("sender identity key", &init.sender_identity_key)?,
                sender_ephemeral_pub: fixed_bytes(
                    "sender ephemeral key",
                    &init.sender_ephemeral_key,
                )?,
                spk_id: init.recipient_signed_prekey_id,
                opk_id: init.recipient_one_time_prekey_id,
            },
            now_unix_ms,
        )
        .map_err(|error| format!("messaging Direct X3DH receive failed: {error}"))?;
        Ok((session, consumed_one_time_prekey_id))
    }
}

impl ClaimedItemConsumer for DirectMessageProcessor {
    fn consume(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

pub(crate) fn encode_direct_ciphertext_aad(
    conversation_id: &str,
    direct: &DirectDeviceCiphertext,
) -> Vec<u8> {
    DirectCiphertextAad {
        command_id: direct.command_id.clone(),
        message_id: direct.message_id.clone(),
        conversation_id: conversation_id.to_string(),
        sender: direct.sender.clone(),
        recipient: direct.recipient.clone(),
        session_id: direct.session_id.clone(),
        session_generation: direct.session_generation,
        protocol_version: direct.protocol_version,
    }
    .encode_to_vec()
}

fn validate_direct_bindings(
    event: &crate::model::chat::ConversationEvent,
    message: &crate::model::chat::MessageCommittedFact,
    direct: &DirectDeviceCiphertext,
    endpoint: &EngineEndpoint,
) -> Result<(), String> {
    let local = CryptoEndpoint {
        ptid: endpoint.ptid.clone(),
        device_id: endpoint.device_id.clone(),
    };
    if direct.command_id != event.command_id
        || direct.message_id != message.message_id
        || direct.sender.is_none()
        || direct.sender != message.sender
        || direct.sender != event.actor
        || direct.recipient.as_ref() != Some(&local)
        || direct.session_id.trim().is_empty()
        || direct.session_generation == 0
        || direct.protocol_version == 0
    {
        return Err("messaging Direct event/ciphertext binding mismatch".to_string());
    }
    Ok(())
}

fn validate_session_binding(
    session: &crate::domain::crypto::DirectSession,
    event: &crate::model::chat::ConversationEvent,
    direct: &DirectDeviceCiphertext,
    endpoint: &EngineEndpoint,
) -> Result<(), String> {
    let sender = direct
        .sender
        .as_ref()
        .ok_or_else(|| "messaging Direct sender is missing".to_string())?;
    if !session.established
        || session.session_id != direct.session_id
        || session.key.conversation_id != event.conversation_id
        || session.key.generation != direct.session_generation
        || session.protocol_version != direct.protocol_version
        || session.key.local.ptid != endpoint.ptid
        || session.key.local.device_id != endpoint.device_id
        || session.key.peer.ptid != sender.ptid
        || session.key.peer.device_id != sender.device_id
    {
        return Err("messaging Direct session binding mismatch".to_string());
    }
    Ok(())
}

fn validate_session_init(
    direct: &DirectDeviceCiphertext,
    init: &DirectSessionInit,
    endpoint: &EngineEndpoint,
) -> Result<(), String> {
    if init.session_id != direct.session_id
        || init.conversation_id.trim().is_empty()
        || init.sender != direct.sender
        || init.recipient != direct.recipient
        || init.recipient.as_ref().is_none_or(|recipient| {
            recipient.ptid != endpoint.ptid || recipient.device_id != endpoint.device_id
        })
        || init.sender_identity_key.len() != 32
        || init.sender_ephemeral_key.len() != 32
        || init.recipient_signed_prekey_id == 0
        || init.protocol_version != direct.protocol_version
        || init.session_generation != direct.session_generation
    {
        return Err("messaging Direct session init binding mismatch".to_string());
    }
    Ok(())
}

fn fixed_bytes<const N: usize>(label: &str, value: &[u8]) -> Result<[u8; N], String> {
    value
        .try_into()
        .map_err(|_| format!("messaging {label} must be {N} bytes"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::crypto::double_ratchet::{encrypt, init_initiator, init_responder};
    use crate::domain::crypto::{
        CryptoEndpoint as SessionEndpoint, DirectSession, DirectSessionKey, X25519KeyPair,
    };
    use crate::messaging::verification::delivery_commitment;
    use crate::model::chat::{
        ConversationEvent, DeviceEventDelivery, DoubleRatchetCiphertext, MessageCommittedFact,
    };

    fn now() -> i64 {
        200
    }

    #[test]
    fn direct_queue_consume_commits_plaintext_ratchet_and_replay_marker_atomically() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let recipient = EngineEndpoint {
            ptid: "ptid:bob".to_string(),
            device_id: "bob-device".to_string(),
        };
        let bob_spk = X25519KeyPair::generate();
        let shared_secret = [7_u8; 32];
        let session_id = "direct-session-1";
        let alice_ratchet = init_initiator(session_id, &shared_secret, bob_spk.public_bytes());
        let bob_ratchet = init_responder(session_id, &shared_secret, bob_spk.private_bytes());
        let alice_endpoint = SessionEndpoint::new("ptid:alice", "alice-device").unwrap();
        let bob_endpoint = SessionEndpoint::new("ptid:bob", "bob-device").unwrap();
        let bob_session = DirectSession {
            session_id: session_id.to_string(),
            key: DirectSessionKey::new(
                "conversation-1",
                bob_endpoint.clone(),
                alice_endpoint.clone(),
                1,
            )
            .unwrap(),
            protocol_version: 1,
            established: true,
            peer_identity_key: [9; 32],
            ratchet: bob_ratchet,
            updated_at_unix_ms: 100,
        };
        store.save_direct_session(&bob_session).unwrap();

        let sender = CryptoEndpoint {
            ptid: alice_endpoint.ptid.clone(),
            device_id: alice_endpoint.device_id.clone(),
        };
        let recipient_proto = CryptoEndpoint {
            ptid: bob_endpoint.ptid.clone(),
            device_id: bob_endpoint.device_id.clone(),
        };
        let mut direct = DirectDeviceCiphertext {
            command_id: "command-1".to_string(),
            message_id: "message-1".to_string(),
            sender: Some(sender.clone()),
            recipient: Some(recipient_proto.clone()),
            session_id: session_id.to_string(),
            session_generation: 1,
            protocol_version: 1,
            ratchet_ciphertext: None,
            ciphertext_sha256: Vec::new(),
            session_init: None,
        };
        let aad = encode_direct_ciphertext_aad("conversation-1", &direct);
        let mut alice_state = alice_ratchet;
        let private_content =
            crate::messaging::encode_message_private_content("exact direct plaintext", &[])
                .unwrap();
        let wire = encrypt(&mut alice_state, &private_content, &aad).unwrap();
        let ratchet = DoubleRatchetCiphertext {
            wire_version: wire.version,
            sender_ratchet_public_key: wire.sender_dh.to_vec(),
            message_counter: wire.n_send,
            previous_chain_length: wire.n_prev,
            nonce: wire.nonce.to_vec(),
            ciphertext: wire.ciphertext,
        };
        direct.ciphertext_sha256 = Sha256::digest(ratchet.encode_to_vec()).to_vec();
        direct.ratchet_ciphertext = Some(ratchet);
        let endpoint_payload = direct.encode_to_vec();
        let endpoint_payload_hash = Sha256::digest(&endpoint_payload).to_vec();

        let mut event = ConversationEvent {
            event_id: "event-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            sequence: 1,
            command_id: "command-1".to_string(),
            actor: Some(sender.clone()),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 0,
                nanos: 150_000_000,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 0,
            authority_station_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::MessageCommitted(
                MessageCommittedFact {
                    message_id: "message-1".to_string(),
                    sender: Some(sender),
                    content_kind: MessagingContentKind::Text as i32,
                    ..Default::default()
                },
            )),
        };
        let commitment = delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &recipient_proto.ptid,
            &recipient_proto.device_id,
            PreparedEndpointPayloadKind::DirectCiphertext,
            &endpoint_payload_hash,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event),
            recipient: Some(recipient_proto.clone()),
            payload_kind: PreparedEndpointPayloadKind::DirectCiphertext as i32,
            endpoint_payload,
            endpoint_payload_sha256: endpoint_payload_hash,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![9; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        let item = DeviceQueueItem {
            item_id: "item-1".to_string(),
            recipient: Some(recipient_proto),
            lane_sequence: 1,
            event_id: "event-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            idempotency_key: "event:event-1".to_string(),
            payload_type: DeviceQueuePayloadType::ConversationEvent as i32,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        };
        let processor = DirectMessageProcessor::new(store.clone(), recipient, now).unwrap();
        store
            .install_test_conversation_projection("conversation-1", 1, 0)
            .unwrap();

        processor.consume(&item, 3).unwrap();
        let committed = store.load_direct_session(session_id).unwrap().unwrap();
        assert_eq!(committed.ratchet.n_recv, 1);
        assert_eq!(store.lane_checkpoint().unwrap(), (1, 3));
        assert!(store
            .consumption_marker_matches(&item.item_id, &item.payload_sha256)
            .unwrap());
        let archive = store
            .build_recovery_archive("ptid:bob", [11; 32], 1)
            .unwrap();
        assert_eq!(archive.messages.len(), 1);
        assert_eq!(archive.messages[0].plaintext, "exact direct plaintext");
        let pending_receipt = store.next_delivery_receipt().unwrap().unwrap();
        let delivery_receipt =
            MessageReceipt::decode(pending_receipt.receipt_bytes.as_slice()).unwrap();
        assert_eq!(delivery_receipt.conversation_id, "conversation-1");
        assert_eq!(delivery_receipt.message_id, "message-1");
        assert_eq!(delivery_receipt.ptid, "ptid:bob");
        assert_eq!(delivery_receipt.device_id, "bob-device");
        assert_eq!(delivery_receipt.receipt_type, ReceiptType::Delivered as i32);
        assert!(delivery_receipt.ts.is_some());
        store
            .mark_delivery_receipt_submitted(
                &pending_receipt.receipt_id,
                &pending_receipt.receipt_bytes,
            )
            .unwrap();

        processor.consume(&item, 3).unwrap();
        let replayed = store.load_direct_session(session_id).unwrap().unwrap();
        assert_eq!(replayed.ratchet.n_recv, 1);
        assert_eq!(
            store
                .build_recovery_archive("ptid:bob", [11; 32], 1)
                .unwrap()
                .messages
                .len(),
            1
        );
        assert!(store.next_delivery_receipt().unwrap().is_none());
    }
}
