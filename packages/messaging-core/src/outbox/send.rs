use crate::codec::private_content::encode_message_private_content;
use crate::contracts::CryptoEndpoint;
use crate::crypto::double_ratchet::{self, DrCiphertextWire};
use crate::crypto::session::DirectSession;
use crate::proto::actor::ActorDeviceRef;
use crate::proto::actor_device_ptid;
use crate::proto::chat::{
    chat_command, AttachmentPlaintextMetadata, ChatCommand, ConversationKind,
    CryptoEndpoint as ProtoCryptoEndpoint, DirectCiphertextAad, DirectDeviceCiphertext,
    DirectSessionInit, DoubleRatchetCiphertext, EditMessageIntent, ForwardMessageIntent,
    MessagingContentKind, PrepareConversationCommandResponse, PreparedEndpointPayload,
    PreparedEndpointPayloadKind, SendMessageIntent,
};
use crate::store::{
    DirectOutboundEditCommit, DirectOutboundRepository, DirectOutboundSendCommit,
    DirectSessionAdvance, PendingSenderProjection,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::Arc;

pub struct DirectSendIntent<'a> {
    pub command_id: &'a str,
    pub message_id: &'a str,
    pub conversation_id: &'a str,
    pub plaintext: &'a str,
    pub reply_to_message_id: &'a str,
    pub thread_root_message_id: &'a str,
    pub attachments: &'a [AttachmentPlaintextMetadata],
    pub client_timestamp_unix_ms: i64,
}

pub struct DirectEditIntent<'a> {
    pub command_id: &'a str,
    pub message_id: &'a str,
    pub conversation_id: &'a str,
    pub plaintext: &'a str,
    pub client_timestamp_unix_ms: i64,
}

pub struct DirectForwardIntent<'a> {
    pub command_id: &'a str,
    pub destination_message_id: &'a str,
    pub conversation_id: &'a str,
    pub plaintext: &'a str,
    pub attachments: &'a [AttachmentPlaintextMetadata],
    pub client_timestamp_unix_ms: i64,
}

#[derive(Clone)]
pub struct DirectSessionBootstrap {
    pub session: DirectSession,
    pub session_init: DirectSessionInit,
}

pub struct DirectSessionWithInit {
    pub session: DirectSession,
    pub session_init: Option<DirectSessionInit>,
}

pub struct DirectFanOutResult {
    pub payloads: Vec<PreparedEndpointPayload>,
    pub advanced_sessions: Vec<DirectSession>,
    pub session_inits: Vec<(String, Vec<u8>)>,
    pub private_content_bytes: Vec<u8>,
}

pub struct DirectOutboundPreparer<R> {
    store: Arc<R>,
    endpoint: ProtoCryptoEndpoint,
}

impl<R: DirectOutboundRepository> DirectOutboundPreparer<R> {
    pub fn new(store: Arc<R>, endpoint: ProtoCryptoEndpoint) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err(
                "messaging Direct outbound preparer requires complete endpoint".to_string(),
            );
        }
        Ok(Self { store, endpoint })
    }

    pub fn prepare_send(
        &self,
        plan: &PrepareConversationCommandResponse,
        intent: &DirectSendIntent<'_>,
        bootstraps: &[DirectSessionBootstrap],
    ) -> Result<ChatCommand, String> {
        validate_send_context(plan, intent, &self.endpoint)?;
        self.store.validate_sender_attachments_ready(
            intent.conversation_id,
            intent.message_id,
            intent.attachments,
        )?;
        validate_authority_head(self.store.as_ref(), plan)?;

        let (sessions, previous_sessions, session_inits) =
            self.resolve_sessions(plan, intent.conversation_id, bootstraps)?;
        let fan_out = encrypt_direct_fan_out(intent, &self.endpoint, sessions)?;
        let command = build_send_command(plan, intent, &self.endpoint, fan_out.payloads)?;
        let command_bytes = command.encode_to_vec();
        let session_advances =
            build_session_advances(previous_sessions, fan_out.advanced_sessions, session_inits)?;
        self.store
            .persist_direct_outbound_send(&DirectOutboundSendCommit {
                command_bytes: &command_bytes,
                expected_authority_sequence: plan.authority_sequence,
                expected_authority_hash: &plan.authority_hash,
                session_advances: &session_advances,
                projection: PendingSenderProjection {
                    command_id: intent.command_id,
                    conversation_id: intent.conversation_id,
                    conversation_kind: plan.conversation_kind,
                    message_id: intent.message_id,
                    sender_ptid: &self.endpoint.ptid,
                    sender_device_id: &self.endpoint.device_id,
                    plaintext: intent.plaintext,
                    reply_to_message_id: intent.reply_to_message_id,
                    thread_root_message_id: intent.thread_root_message_id,
                    attachments: intent.attachments,
                    private_content: &fan_out.private_content_bytes,
                    delivery_plan_sha256: &plan.delivery_plan_sha256,
                    created_at_unix_ms: intent.client_timestamp_unix_ms,
                },
            })?;
        Ok(command)
    }

    pub fn prepare_edit(
        &self,
        plan: &PrepareConversationCommandResponse,
        intent: &DirectEditIntent<'_>,
        bootstraps: &[DirectSessionBootstrap],
    ) -> Result<ChatCommand, String> {
        validate_edit_context(plan, intent, &self.endpoint)?;
        validate_authority_head(self.store.as_ref(), plan)?;

        let direct_intent = DirectSendIntent {
            command_id: intent.command_id,
            message_id: intent.message_id,
            conversation_id: intent.conversation_id,
            plaintext: intent.plaintext,
            reply_to_message_id: "",
            thread_root_message_id: "",
            attachments: &[],
            client_timestamp_unix_ms: intent.client_timestamp_unix_ms,
        };
        let (sessions, previous_sessions, session_inits) =
            self.resolve_sessions(plan, intent.conversation_id, bootstraps)?;
        let fan_out = encrypt_direct_fan_out(&direct_intent, &self.endpoint, sessions)?;
        let command = build_edit_command(plan, intent, &self.endpoint, fan_out.payloads);
        let command_bytes = command.encode_to_vec();
        let session_advances =
            build_session_advances(previous_sessions, fan_out.advanced_sessions, session_inits)?;
        self.store
            .persist_direct_outbound_edit(&DirectOutboundEditCommit {
                command_id: intent.command_id,
                conversation_id: intent.conversation_id,
                target_message_id: intent.message_id,
                edited_text: intent.plaintext,
                command_bytes: &command_bytes,
                delivery_plan_sha256: &plan.delivery_plan_sha256,
                expected_authority_sequence: plan.authority_sequence,
                expected_authority_hash: &plan.authority_hash,
                session_advances: &session_advances,
                created_at_unix_ms: intent.client_timestamp_unix_ms,
            })?;
        Ok(command)
    }

    pub fn prepare_forward(
        &self,
        plan: &PrepareConversationCommandResponse,
        intent: &DirectForwardIntent<'_>,
        bootstraps: &[DirectSessionBootstrap],
    ) -> Result<ChatCommand, String> {
        let send = DirectSendIntent {
            command_id: intent.command_id,
            message_id: intent.destination_message_id,
            conversation_id: intent.conversation_id,
            plaintext: intent.plaintext,
            reply_to_message_id: "",
            thread_root_message_id: "",
            attachments: intent.attachments,
            client_timestamp_unix_ms: intent.client_timestamp_unix_ms,
        };
        validate_send_context(plan, &send, &self.endpoint)?;
        self.store.validate_sender_attachments_ready(
            intent.conversation_id,
            intent.destination_message_id,
            intent.attachments,
        )?;
        validate_authority_head(self.store.as_ref(), plan)?;

        let (sessions, previous_sessions, session_inits) =
            self.resolve_sessions(plan, intent.conversation_id, bootstraps)?;
        let fan_out = encrypt_direct_fan_out(&send, &self.endpoint, sessions)?;
        let command = build_forward_command(plan, intent, &self.endpoint, fan_out.payloads)?;
        let command_bytes = command.encode_to_vec();
        let session_advances =
            build_session_advances(previous_sessions, fan_out.advanced_sessions, session_inits)?;
        self.store
            .persist_direct_outbound_send(&DirectOutboundSendCommit {
                command_bytes: &command_bytes,
                expected_authority_sequence: plan.authority_sequence,
                expected_authority_hash: &plan.authority_hash,
                session_advances: &session_advances,
                projection: PendingSenderProjection {
                    command_id: intent.command_id,
                    conversation_id: intent.conversation_id,
                    conversation_kind: plan.conversation_kind,
                    message_id: intent.destination_message_id,
                    sender_ptid: &self.endpoint.ptid,
                    sender_device_id: &self.endpoint.device_id,
                    plaintext: intent.plaintext,
                    reply_to_message_id: "",
                    thread_root_message_id: "",
                    attachments: intent.attachments,
                    private_content: &fan_out.private_content_bytes,
                    delivery_plan_sha256: &plan.delivery_plan_sha256,
                    created_at_unix_ms: intent.client_timestamp_unix_ms,
                },
            })?;
        Ok(command)
    }

    fn resolve_sessions(
        &self,
        plan: &PrepareConversationCommandResponse,
        conversation_id: &str,
        bootstraps: &[DirectSessionBootstrap],
    ) -> Result<
        (
            Vec<DirectSessionWithInit>,
            Vec<Option<DirectSession>>,
            Vec<Option<Vec<u8>>>,
        ),
        String,
    > {
        let local =
            CryptoEndpoint::new(self.endpoint.ptid.clone(), self.endpoint.device_id.clone())?;
        let required_endpoints = plan
            .required_endpoints
            .iter()
            .map(contract_endpoint)
            .collect::<Result<Vec<_>, _>>()?;
        let peers = required_endpoints
            .into_iter()
            .filter(|endpoint| endpoint != &local)
            .collect::<Vec<_>>();
        let peer_keys = peers
            .iter()
            .map(|peer| (peer.ptid.as_str(), peer.device_id.as_str()))
            .collect::<HashSet<_>>();
        let mut bootstrap_keys = HashSet::with_capacity(bootstraps.len());
        for bootstrap in bootstraps {
            validate_bootstrap(bootstrap, conversation_id, &local)?;
            let key = (
                bootstrap.session.key.peer.ptid.as_str(),
                bootstrap.session.key.peer.device_id.as_str(),
            );
            if !peer_keys.contains(&key) || !bootstrap_keys.insert(key) {
                return Err("messaging Direct bootstrap endpoint set mismatch".to_string());
            }
        }

        let mut sessions = Vec::with_capacity(peers.len());
        let mut previous_sessions = Vec::with_capacity(peers.len());
        let mut session_inits = Vec::with_capacity(peers.len());
        for peer in peers {
            let bootstrap = bootstraps
                .iter()
                .find(|candidate| candidate.session.key.peer == peer);
            let stored = self
                .store
                .load_direct_outbound_session(conversation_id, &peer)?;
            let (session, session_init, previous) = match (bootstrap, stored) {
                (Some(_), Some(_)) => {
                    return Err(
                        "messaging Direct bootstrap conflicts with established session".to_string(),
                    );
                }
                (Some(bootstrap), None) => (
                    bootstrap.session.clone(),
                    Some(bootstrap.session_init.clone()),
                    None,
                ),
                (None, Some(stored)) => {
                    let session_init = stored
                        .session_init
                        .map(|bytes| {
                            DirectSessionInit::decode(bytes.as_slice()).map_err(|_| {
                                "messaging Direct stored session init is invalid".to_string()
                            })
                        })
                        .transpose()?;
                    (stored.session.clone(), session_init, Some(stored.session))
                }
                (None, None) => {
                    return Err(format!(
                        "messaging Direct session unavailable for endpoint ({}, {})",
                        peer.ptid, peer.device_id
                    ));
                }
            };
            session_inits.push(session_init.as_ref().map(Message::encode_to_vec));
            previous_sessions.push(previous);
            sessions.push(DirectSessionWithInit {
                session,
                session_init,
            });
        }
        Ok((sessions, previous_sessions, session_inits))
    }
}

pub fn encrypt_direct_fan_out(
    intent: &DirectSendIntent<'_>,
    local: &ProtoCryptoEndpoint,
    sessions: Vec<DirectSessionWithInit>,
) -> Result<DirectFanOutResult, String> {
    if sessions.is_empty() {
        return Err("messaging Direct fan-out requires at least one peer session".to_string());
    }
    let private_content = encode_message_private_content(intent.plaintext, intent.attachments)?;
    let mut advanced_sessions = Vec::with_capacity(sessions.len());
    let mut session_inits = Vec::new();
    let mut payloads = Vec::with_capacity(sessions.len());

    for DirectSessionWithInit {
        mut session,
        session_init,
    } in sessions
    {
        if session.key.local.ptid != local.ptid || session.key.local.device_id != local.device_id {
            return Err("messaging Direct session local endpoint mismatch".to_string());
        }
        let recipient = ProtoCryptoEndpoint {
            ptid: session.key.peer.ptid.clone(),
            device_id: session.key.peer.device_id.clone(),
        };
        let mut direct = DirectDeviceCiphertext {
            command_id: intent.command_id.to_string(),
            message_id: intent.message_id.to_string(),
            sender: Some(local.clone()),
            recipient: Some(recipient.clone()),
            session_id: session.session_id.clone(),
            session_generation: session.key.generation,
            protocol_version: session.protocol_version,
            ratchet_ciphertext: None,
            ciphertext_sha256: Vec::new(),
            session_init,
        };
        if let Some(init) = direct.session_init.as_ref() {
            session_inits.push((session.session_id.clone(), init.encode_to_vec()));
        }
        let aad = DirectCiphertextAad {
            command_id: direct.command_id.clone(),
            message_id: direct.message_id.clone(),
            conversation_id: intent.conversation_id.to_string(),
            sender: direct.sender.clone(),
            recipient: direct.recipient.clone(),
            session_id: direct.session_id.clone(),
            session_generation: direct.session_generation,
            protocol_version: direct.protocol_version,
        }
        .encode_to_vec();
        let wire = double_ratchet::encrypt(&mut session.ratchet, &private_content, &aad)
            .map_err(|error| format!("messaging Direct encrypt failed: {error}"))?;
        session.established = true;
        session.updated_at_unix_ms = intent.client_timestamp_unix_ms;
        let ratchet_ciphertext = wire_to_ratchet_proto(&wire);
        direct.ciphertext_sha256 = Sha256::digest(ratchet_ciphertext.encode_to_vec()).to_vec();
        direct.ratchet_ciphertext = Some(ratchet_ciphertext);
        let endpoint_payload = direct.encode_to_vec();
        let endpoint_payload_sha256 = Sha256::digest(&endpoint_payload).to_vec();
        payloads.push(PreparedEndpointPayload {
            recipient: Some(recipient),
            kind: PreparedEndpointPayloadKind::DirectCiphertext as i32,
            opaque_payload: endpoint_payload,
            payload_sha256: endpoint_payload_sha256,
        });
        advanced_sessions.push(session);
    }

    Ok(DirectFanOutResult {
        payloads,
        advanced_sessions,
        session_inits,
        private_content_bytes: private_content,
    })
}

fn validate_send_context(
    plan: &PrepareConversationCommandResponse,
    intent: &DirectSendIntent<'_>,
    endpoint: &ProtoCryptoEndpoint,
) -> Result<(), String> {
    let private_content = encode_message_private_content(intent.plaintext, intent.attachments)?;
    if intent.command_id.trim().is_empty()
        || intent.message_id.trim().is_empty()
        || intent.conversation_id.trim().is_empty()
        || intent.client_timestamp_unix_ms <= 0
        || plan.conversation_id != intent.conversation_id
        || plan.authority_station_peer_id.trim().is_empty()
        || plan.delivery_plan_sha256.len() != 32
        || plan.membership_epoch < 0
        || plan.mls_epoch < 0
        || ConversationKind::try_from(plan.conversation_kind)
            .map_err(|_| "messaging send plan kind is invalid".to_string())?
            != ConversationKind::Direct
    {
        return Err("messaging send context is incomplete".to_string());
    }
    if private_content.is_empty() {
        return Err("messaging private content is empty".to_string());
    }
    let mut previous: Option<(&str, &str)> = None;
    let mut local_count = 0;
    for required in &plan.required_endpoints {
        let required_ptid = actor_device_ptid(required)?;
        if required.device_id.trim().is_empty() {
            return Err("messaging send plan has incomplete endpoint".to_string());
        }
        let key = (required_ptid, required.device_id.as_str());
        if previous.is_some_and(|value| value >= key) {
            return Err("messaging send plan endpoints are not strictly sorted".to_string());
        }
        previous = Some(key);
        if required_ptid == endpoint.ptid && required.device_id == endpoint.device_id {
            local_count += 1;
        }
    }
    if local_count != 1 || plan.required_endpoints.len() < 2 {
        return Err("messaging send plan does not contain the sending endpoint".to_string());
    }
    Ok(())
}

fn validate_edit_context(
    plan: &PrepareConversationCommandResponse,
    intent: &DirectEditIntent<'_>,
    endpoint: &ProtoCryptoEndpoint,
) -> Result<(), String> {
    validate_send_context(
        plan,
        &DirectSendIntent {
            command_id: intent.command_id,
            message_id: intent.message_id,
            conversation_id: intent.conversation_id,
            plaintext: intent.plaintext,
            reply_to_message_id: "",
            thread_root_message_id: "",
            attachments: &[],
            client_timestamp_unix_ms: intent.client_timestamp_unix_ms,
        },
        endpoint,
    )
}

fn validate_authority_head<R: DirectOutboundRepository>(
    store: &R,
    plan: &PrepareConversationCommandResponse,
) -> Result<(), String> {
    let (local_sequence, local_hash) = store.authority_head(&plan.conversation_id)?;
    if local_sequence != plan.authority_sequence || local_hash != plan.authority_hash {
        return Err("messaging local authority head is behind send plan".to_string());
    }
    Ok(())
}

fn validate_bootstrap(
    bootstrap: &DirectSessionBootstrap,
    conversation_id: &str,
    local: &CryptoEndpoint,
) -> Result<(), String> {
    bootstrap.session.key.validate()?;
    let init = &bootstrap.session_init;
    let sender = init
        .sender
        .as_ref()
        .ok_or_else(|| "messaging Direct bootstrap sender is missing".to_string())?;
    let recipient = init
        .recipient
        .as_ref()
        .ok_or_else(|| "messaging Direct bootstrap recipient is missing".to_string())?;
    if bootstrap.session.established
        || bootstrap.session.key.conversation_id != conversation_id
        || bootstrap.session.key.local != *local
        || init.session_id != bootstrap.session.session_id
        || init.conversation_id != conversation_id
        || init.protocol_version != bootstrap.session.protocol_version
        || init.session_generation != bootstrap.session.key.generation
        || sender.ptid != local.ptid
        || sender.device_id != local.device_id
        || recipient.ptid != bootstrap.session.key.peer.ptid
        || recipient.device_id != bootstrap.session.key.peer.device_id
    {
        return Err("messaging Direct bootstrap binding mismatch".to_string());
    }
    Ok(())
}

fn build_session_advances(
    previous_sessions: Vec<Option<DirectSession>>,
    advanced_sessions: Vec<DirectSession>,
    session_inits: Vec<Option<Vec<u8>>>,
) -> Result<Vec<DirectSessionAdvance>, String> {
    if previous_sessions.len() != advanced_sessions.len()
        || session_inits.len() != advanced_sessions.len()
    {
        return Err("messaging Direct session advance set mismatch".to_string());
    }
    Ok(previous_sessions
        .into_iter()
        .zip(advanced_sessions)
        .zip(session_inits)
        .map(
            |((previous, advanced), session_init)| DirectSessionAdvance {
                previous,
                advanced,
                session_init,
            },
        )
        .collect())
}

fn build_send_command(
    plan: &PrepareConversationCommandResponse,
    intent: &DirectSendIntent<'_>,
    endpoint: &ProtoCryptoEndpoint,
    direct_payloads: Vec<PreparedEndpointPayload>,
) -> Result<ChatCommand, String> {
    let attachments = intent
        .attachments
        .iter()
        .map(|attachment| {
            attachment
                .object
                .clone()
                .ok_or_else(|| "messaging attachment descriptor is missing".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ChatCommand {
        command_id: intent.command_id.to_string(),
        conversation_id: intent.conversation_id.to_string(),
        sender: Some(endpoint.clone()),
        observed_membership_epoch: plan.membership_epoch,
        observed_mls_epoch: plan.mls_epoch,
        client_timestamp: Some(timestamp(intent.client_timestamp_unix_ms)),
        delivery_plan_sha256: plan.delivery_plan_sha256.clone(),
        authority_station_peer_id: plan.authority_station_peer_id.clone(),
        payload: Some(chat_command::Payload::SendMessage(SendMessageIntent {
            message_id: intent.message_id.to_string(),
            content_kind: MessagingContentKind::Text as i32,
            reply_to_message_id: intent.reply_to_message_id.to_string(),
            thread_root_message_id: intent.thread_root_message_id.to_string(),
            attachments,
            direct_payloads,
            mls_application_payload: Vec::new(),
            mls_application_payload_sha256: Vec::new(),
        })),
    })
}

fn build_forward_command(
    plan: &PrepareConversationCommandResponse,
    intent: &DirectForwardIntent<'_>,
    endpoint: &ProtoCryptoEndpoint,
    destination_payloads: Vec<PreparedEndpointPayload>,
) -> Result<ChatCommand, String> {
    let attachments = intent
        .attachments
        .iter()
        .map(|attachment| {
            attachment
                .object
                .clone()
                .ok_or_else(|| "messaging forward attachment descriptor is missing".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ChatCommand {
        command_id: intent.command_id.to_string(),
        conversation_id: intent.conversation_id.to_string(),
        sender: Some(endpoint.clone()),
        observed_membership_epoch: plan.membership_epoch,
        observed_mls_epoch: plan.mls_epoch,
        client_timestamp: Some(timestamp(intent.client_timestamp_unix_ms)),
        delivery_plan_sha256: plan.delivery_plan_sha256.clone(),
        authority_station_peer_id: plan.authority_station_peer_id.clone(),
        payload: Some(chat_command::Payload::ForwardMessage(
            ForwardMessageIntent {
                destination_message_id: intent.destination_message_id.to_string(),
                content_kind: MessagingContentKind::Text as i32,
                destination_attachments: attachments,
                destination_payloads,
                mls_application_payload: Vec::new(),
                mls_application_payload_sha256: Vec::new(),
            },
        )),
    })
}

fn build_edit_command(
    plan: &PrepareConversationCommandResponse,
    intent: &DirectEditIntent<'_>,
    endpoint: &ProtoCryptoEndpoint,
    direct_payloads: Vec<PreparedEndpointPayload>,
) -> ChatCommand {
    ChatCommand {
        command_id: intent.command_id.to_string(),
        conversation_id: intent.conversation_id.to_string(),
        sender: Some(endpoint.clone()),
        observed_membership_epoch: plan.membership_epoch,
        observed_mls_epoch: plan.mls_epoch,
        client_timestamp: Some(timestamp(intent.client_timestamp_unix_ms)),
        delivery_plan_sha256: plan.delivery_plan_sha256.clone(),
        authority_station_peer_id: plan.authority_station_peer_id.clone(),
        payload: Some(chat_command::Payload::EditMessage(EditMessageIntent {
            message_id: intent.message_id.to_string(),
            direct_payloads,
            mls_application_payload: Vec::new(),
            mls_application_payload_sha256: Vec::new(),
        })),
    }
}

fn contract_endpoint(endpoint: &ActorDeviceRef) -> Result<CryptoEndpoint, String> {
    let endpoint = CryptoEndpoint {
        ptid: actor_device_ptid(endpoint)?.to_string(),
        device_id: endpoint.device_id.clone(),
    };
    if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
        return Err("messaging Direct endpoint is incomplete".to_string());
    }
    Ok(endpoint)
}

fn timestamp(unix_ms: i64) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: unix_ms.div_euclid(1_000),
        nanos: (unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
    }
}

fn wire_to_ratchet_proto(wire: &DrCiphertextWire) -> DoubleRatchetCiphertext {
    DoubleRatchetCiphertext {
        wire_version: wire.version,
        sender_ratchet_public_key: wire.sender_dh.to_vec(),
        message_counter: wire.n_send,
        previous_chain_length: wire.n_prev,
        nonce: wire.nonce.to_vec(),
        ciphertext: wire.ciphertext.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::double_ratchet::init_initiator;
    use crate::crypto::identity::X25519KeyPair;
    use crate::crypto::session::DirectSessionKey;
    use crate::proto::actor_device_ref;
    use crate::store::DirectOutboundSession;
    use std::sync::Mutex;

    struct TestRepository {
        session: DirectOutboundSession,
        persisted: Mutex<Option<(Vec<u8>, u32, u32, String, String)>>,
    }

    impl DirectOutboundRepository for TestRepository {
        fn validate_sender_attachments_ready(
            &self,
            _conversation_id: &str,
            _message_id: &str,
            _attachments: &[AttachmentPlaintextMetadata],
        ) -> Result<(), String> {
            Ok(())
        }

        fn authority_head(&self, _conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
            Ok((0, Vec::new()))
        }

        fn load_direct_outbound_session(
            &self,
            _conversation_id: &str,
            peer: &CryptoEndpoint,
        ) -> Result<Option<DirectOutboundSession>, String> {
            if &self.session.session.key.peer == peer {
                Ok(Some(self.session.clone()))
            } else {
                Ok(None)
            }
        }

        fn next_direct_session_generation(
            &self,
            _conversation_id: &str,
            _peer: &CryptoEndpoint,
        ) -> Result<u64, String> {
            Ok(self.session.session.key.generation + 1)
        }

        fn persist_direct_outbound_send(
            &self,
            commit: &DirectOutboundSendCommit<'_>,
        ) -> Result<(), String> {
            let advance = commit
                .session_advances
                .first()
                .ok_or_else(|| "missing session advance".to_string())?;
            *self.persisted.lock().unwrap() = Some((
                commit.command_bytes.to_vec(),
                advance
                    .previous
                    .as_ref()
                    .ok_or_else(|| "missing previous session".to_string())?
                    .ratchet
                    .n_send,
                advance.advanced.ratchet.n_send,
                commit.projection.reply_to_message_id.to_string(),
                commit.projection.thread_root_message_id.to_string(),
            ));
            Ok(())
        }

        fn persist_direct_outbound_edit(
            &self,
            _commit: &DirectOutboundEditCommit<'_>,
        ) -> Result<(), String> {
            Err("unexpected edit".to_string())
        }
    }

    fn endpoint(ptid: &str, device_id: &str) -> CryptoEndpoint {
        CryptoEndpoint::new(ptid, device_id).unwrap()
    }

    #[test]
    fn outbound_preparer_owns_command_construction_and_ratchet_advance() {
        let local = endpoint("ptid:alice", "alice-device");
        let peer = endpoint("ptid:bob", "bob-device");
        let peer_spk = X25519KeyPair::generate();
        let session_id = "session-1";
        let session = DirectSession {
            session_id: session_id.to_string(),
            key: DirectSessionKey::new("conversation-1", local.clone(), peer.clone(), 1).unwrap(),
            protocol_version: 1,
            established: true,
            peer_identity_key: [1; 32],
            ratchet: init_initiator(session_id, &[2; 32], peer_spk.public_bytes()),
            updated_at_unix_ms: 10,
        };
        let repository = Arc::new(TestRepository {
            session: DirectOutboundSession {
                session,
                session_init: None,
            },
            persisted: Mutex::new(None),
        });
        let plan = PrepareConversationCommandResponse {
            conversation_id: "conversation-1".to_string(),
            conversation_kind: ConversationKind::Direct as i32,
            authority_sequence: 0,
            authority_hash: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 0,
            required_endpoints: vec![
                actor_device_ref(&local.ptid, &local.device_id),
                actor_device_ref(&peer.ptid, &peer.device_id),
            ],
            delivery_plan_sha256: vec![7; 32],
            endpoint_manifests: Vec::new(),
            authority_station_peer_id: "station-1".to_string(),
        };
        let command = DirectOutboundPreparer::new(
            repository.clone(),
            ProtoCryptoEndpoint {
                ptid: local.ptid,
                device_id: local.device_id,
            },
        )
        .unwrap()
        .prepare_send(
            &plan,
            &DirectSendIntent {
                command_id: "command-1",
                message_id: "message-1",
                conversation_id: "conversation-1",
                plaintext: "hello",
                reply_to_message_id: "message-parent",
                thread_root_message_id: "message-root",
                attachments: &[],
                client_timestamp_unix_ms: 20,
            },
            &[],
        )
        .unwrap();

        let send = match command.payload.as_ref().unwrap() {
            chat_command::Payload::SendMessage(send) => send,
            _ => panic!("unexpected command payload"),
        };
        assert_eq!(send.direct_payloads.len(), 1);
        assert_eq!(send.reply_to_message_id, "message-parent");
        assert_eq!(send.thread_root_message_id, "message-root");
        let persisted = repository.persisted.lock().unwrap().clone().unwrap();
        assert_eq!(persisted.0, command.encode_to_vec());
        assert_eq!((persisted.1, persisted.2), (0, 1));
        assert_eq!(persisted.3, "message-parent");
        assert_eq!(persisted.4, "message-root");
    }

    #[test]
    fn outbound_forward_creates_a_fresh_destination_message_and_ciphertext() {
        let local = endpoint("ptid:alice", "alice-device");
        let peer = endpoint("ptid:bob", "bob-device");
        let peer_spk = X25519KeyPair::generate();
        let session_id = "forward-session-1";
        let session = DirectSession {
            session_id: session_id.to_string(),
            key: DirectSessionKey::new("conversation-1", local.clone(), peer.clone(), 1).unwrap(),
            protocol_version: 1,
            established: true,
            peer_identity_key: [1; 32],
            ratchet: init_initiator(session_id, &[2; 32], peer_spk.public_bytes()),
            updated_at_unix_ms: 10,
        };
        let repository = Arc::new(TestRepository {
            session: DirectOutboundSession {
                session,
                session_init: None,
            },
            persisted: Mutex::new(None),
        });

        let command = DirectOutboundPreparer::new(
            repository.clone(),
            ProtoCryptoEndpoint {
                ptid: local.ptid,
                device_id: local.device_id,
            },
        )
        .unwrap()
        .prepare_forward(
            &PrepareConversationCommandResponse {
                conversation_id: "conversation-1".to_string(),
                conversation_kind: ConversationKind::Direct as i32,
                membership_epoch: 1,
                required_endpoints: vec![
                    actor_device_ref("ptid:alice", "alice-device"),
                    actor_device_ref("ptid:bob", "bob-device"),
                ],
                delivery_plan_sha256: vec![7; 32],
                authority_station_peer_id: "station-1".to_string(),
                ..Default::default()
            },
            &DirectForwardIntent {
                command_id: "forward-command-1",
                destination_message_id: "destination-message-1",
                conversation_id: "conversation-1",
                plaintext: "fresh destination plaintext",
                attachments: &[],
                client_timestamp_unix_ms: 20,
            },
            &[],
        )
        .unwrap();

        let forward = match command.payload.as_ref().unwrap() {
            chat_command::Payload::ForwardMessage(forward) => forward,
            _ => panic!("unexpected command payload"),
        };
        assert_eq!(forward.destination_message_id, "destination-message-1");
        assert_eq!(forward.destination_payloads.len(), 1);
        let ciphertext = DirectDeviceCiphertext::decode(
            forward.destination_payloads[0].opaque_payload.as_slice(),
        )
        .unwrap();
        assert_eq!(ciphertext.command_id, "forward-command-1");
        assert_eq!(ciphertext.message_id, "destination-message-1");
        assert!(!ciphertext.ciphertext_sha256.is_empty());
        let persisted = repository.persisted.lock().unwrap().clone().unwrap();
        assert_eq!(persisted.0, command.encode_to_vec());
        assert_eq!((persisted.1, persisted.2), (0, 1));
        assert!(persisted.3.is_empty());
        assert!(persisted.4.is_empty());
    }
}
