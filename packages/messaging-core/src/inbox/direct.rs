use crate::codec::private_content::decode_message_private_content;
use crate::codec::verification::verify_device_event_delivery;
use crate::contracts::{
    CryptoEndpoint, DirectEditCommit, DirectMessageContent, DirectReceiveCommit,
};
use crate::crypto::double_ratchet::{self, DrCiphertextWire};
use crate::crypto::identity::{IdentityKeyPair, X25519KeyPair};
use crate::crypto::session::{self, DirectSession, DirectSessionKey};
use crate::crypto::x3dh::X3dhReceiverInput;
use crate::proto::chat::{
    conversation_event, CryptoEndpoint as ProtoCryptoEndpoint, DeviceQueueItem,
    DeviceQueuePayloadType, DirectCiphertextAad, DirectDeviceCiphertext, DirectSessionInit,
    MessagingContentKind, PreparedEndpointPayloadKind,
};
use crate::store::MessagingRepository;
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

use super::ClaimedItemConsumer;

pub struct DirectMessageProcessor<R: MessagingRepository> {
    store: Arc<R>,
    endpoint: CryptoEndpoint,
    actor_identity: Option<Arc<IdentityKeyPair>>,
    clock: fn() -> i64,
}

impl<R: MessagingRepository> DirectMessageProcessor<R> {
    pub fn new(
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        Self::with_optional_actor_identity(store, endpoint, None, clock)
    }

    pub fn with_actor_identity(
        store: Arc<R>,
        endpoint: CryptoEndpoint,
        actor_identity: Arc<IdentityKeyPair>,
        clock: fn() -> i64,
    ) -> Result<Self, String> {
        Self::with_optional_actor_identity(store, endpoint, Some(actor_identity), clock)
    }

    fn with_optional_actor_identity(
        store: Arc<R>,
        endpoint: CryptoEndpoint,
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
                        "messaging Direct processor only accepts text projections".to_string(),
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

        let (mut dr_session, consumed_one_time_prekey_id) =
            match self.store.load_direct_session(&direct.session_id)? {
                Some(s) => {
                    if let Some(init) = direct.session_init.as_ref() {
                        validate_session_init(&direct, init, &self.endpoint)?;
                        if init.sender_identity_key != s.peer_identity_key {
                            return Err("messaging Direct repeated session init identity mismatch"
                                .to_string());
                        }
                    }
                    (s, None)
                }
                None => self.prepare_receiver_session(&direct, now)?,
            };
        validate_session_binding(&dr_session, event, &direct, &self.endpoint)?;
        let skipped = self.store.load_direct_skipped_keys(&direct.session_id)?;
        let aad = encode_direct_ciphertext_aad(event.conversation_id.as_str(), &direct);
        let outcome = double_ratchet::decrypt(&dr_session.ratchet, &wire, &skipped, &aad)
            .map_err(|error| format!("messaging Direct decrypt failed: {error}"))?;
        let private_content = decode_message_private_content(&outcome.plaintext)?;
        dr_session.ratchet = outcome.advanced_state;
        dr_session.updated_at_unix_ms = now;

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

        let receipt_id = format!("device-consumed:{}", item.item_id);
        let receipt = crate::proto::chat::DeviceConsumptionReceipt {
            receipt_id: receipt_id.clone(),
            conversation_id: event.conversation_id.clone(),
            event_id: event.event_id.clone(),
            consumer: Some(ProtoCryptoEndpoint {
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
        let delivery_receipt = crate::proto::chat::MessageReceipt {
            conversation_id: event.conversation_id.clone(),
            message_id: message_id.to_string(),
            ptid: self.endpoint.ptid.clone(),
            device_id: self.endpoint.device_id.clone(),
            receipt_type: crate::proto::chat::ReceiptType::Delivered as i32,
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
                session: &dr_session,
                new_skipped: &outcome.new_skipped,
                consumed_skipped: outcome.consumed_skipped,
                consumed_one_time_prekey_id,
                message_id,
                edited_text: &private_content.text,
                edited_at_unix_ms: committed_at_unix_ms,
                receipt_id: &receipt_id,
                receipt_bytes: &receipt_bytes,
                delivery_receipt_id: &delivery_receipt_id,
                delivery_receipt_bytes: &delivery_receipt_bytes,
                consumed_at_unix_ms: now,
            };
            self.store.commit_direct_edit(&input)?;
        } else {
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
            let projection = DirectMessageContent {
                conversation_id: event.conversation_id.clone(),
                event_id: event.event_id.clone(),
                event_sequence: event.sequence,
                message_id: message_id.to_string(),
                sender_ptid: direct
                    .sender
                    .as_ref()
                    .map(|ep| ep.ptid.clone())
                    .unwrap_or_default(),
                sender_device_id: direct
                    .sender
                    .as_ref()
                    .map(|ep| ep.device_id.clone())
                    .unwrap_or_default(),
                plaintext: private_content.text,
                attachments: private_content.attachments,
                committed_at_unix_ms,
                reply_to_message_id: reply_to.clone(),
                thread_root_message_id: thread_root.clone(),
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
                session: &dr_session,
                new_skipped: &outcome.new_skipped,
                consumed_skipped: outcome.consumed_skipped,
                consumed_one_time_prekey_id,
                projection: &projection,
                receipt_id: &receipt_id,
                receipt_bytes: &receipt_bytes,
                delivery_receipt_id: &delivery_receipt_id,
                delivery_receipt_bytes: &delivery_receipt_bytes,
                consumed_at_unix_ms: now,
            };
            self.store.commit_direct_receive(&input)?;
        }
        Ok(())
    }

    fn prepare_receiver_session(
        &self,
        direct: &DirectDeviceCiphertext,
        now_unix_ms: i64,
    ) -> Result<(DirectSession, Option<i32>), String> {
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
        let (one_time_prekey, consumed_one_time_prekey_id) =
            match init.recipient_one_time_prekey_id {
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
        let local = CryptoEndpoint {
            ptid: self.endpoint.ptid.clone(),
            device_id: self.endpoint.device_id.clone(),
        };
        let peer = CryptoEndpoint {
            ptid: sender.ptid.clone(),
            device_id: sender.device_id.clone(),
        };
        let key = DirectSessionKey::new(
            init.conversation_id.clone(),
            local,
            peer,
            init.session_generation,
        )?;
        let dr_session = session::establish_receiver_session(
            direct.session_id.clone(),
            key,
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
        )?;
        Ok((dr_session, consumed_one_time_prekey_id))
    }
}

impl<R: MessagingRepository> ClaimedItemConsumer for DirectMessageProcessor<R> {
    fn consume(&self, item: &DeviceQueueItem, consumer_epoch: u64) -> Result<(), String> {
        self.process(item, consumer_epoch)
    }
}

pub fn encode_direct_ciphertext_aad(
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
    event: &crate::proto::chat::ConversationEvent,
    message: &crate::proto::chat::MessageCommittedFact,
    direct: &DirectDeviceCiphertext,
    endpoint: &CryptoEndpoint,
) -> Result<(), String> {
    let local = ProtoCryptoEndpoint {
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
    s: &DirectSession,
    event: &crate::proto::chat::ConversationEvent,
    direct: &DirectDeviceCiphertext,
    endpoint: &CryptoEndpoint,
) -> Result<(), String> {
    let sender = direct
        .sender
        .as_ref()
        .ok_or_else(|| "messaging Direct sender is missing".to_string())?;
    if !s.established
        || s.session_id != direct.session_id
        || s.key.conversation_id != event.conversation_id
        || s.key.generation != direct.session_generation
        || s.protocol_version != direct.protocol_version
        || s.key.local.ptid != endpoint.ptid
        || s.key.local.device_id != endpoint.device_id
        || s.key.peer.ptid != sender.ptid
        || s.key.peer.device_id != sender.device_id
    {
        return Err("messaging Direct session binding mismatch".to_string());
    }
    Ok(())
}

fn validate_session_init(
    direct: &DirectDeviceCiphertext,
    init: &DirectSessionInit,
    endpoint: &CryptoEndpoint,
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
