use super::{
    encode_message_private_content, DirectSendCommit, EngineEndpoint, InteractionCommandCommit,
    MessagingStore, MlsSendCommit, PendingSenderProjection,
};
use crate::domain::crypto::double_ratchet::{self, DrCiphertextWire};
use crate::domain::crypto::{CryptoEndpoint as SessionEndpoint, DirectSession};
use crate::domain::mls_group::MlsGroupManager;
use crate::model::chat::{
    chat_command, AttachmentPlaintextMetadata, ChatCommand, ConversationKind, CryptoEndpoint,
    DirectCiphertextAad, DirectDeviceCiphertext, DirectSessionInit, DoubleRatchetCiphertext,
    EditMessageIntent, MessagingContentKind, PrepareMessagingSendResponse, PreparedEndpointPayload,
    PreparedEndpointPayloadKind, SendMessageIntent,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub struct SendTextIntent<'a> {
    pub command_id: &'a str,
    pub message_id: &'a str,
    pub conversation_id: &'a str,
    pub plaintext: &'a str,
    pub reply_to_message_id: &'a str,
    pub thread_root_message_id: &'a str,
    pub attachments: &'a [AttachmentPlaintextMetadata],
    pub client_timestamp_unix_ms: i64,
}

pub struct EditTextIntent<'a> {
    pub command_id: &'a str,
    pub message_id: &'a str,
    pub conversation_id: &'a str,
    pub plaintext: &'a str,
    pub client_timestamp_unix_ms: i64,
}

pub struct DirectSessionBootstrap {
    pub session: DirectSession,
    pub session_init: DirectSessionInit,
}

pub struct SendPreparer {
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
    mls_manager: Arc<MlsGroupManager>,
}

impl SendPreparer {
    pub fn new(
        store: Arc<MessagingStore>,
        endpoint: EngineEndpoint,
        mls_manager: Arc<MlsGroupManager>,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging send preparer requires complete endpoint".to_string());
        }
        Ok(Self {
            store,
            endpoint,
            mls_manager,
        })
    }

    pub fn prepare_direct_text(
        &self,
        plan: &PrepareMessagingSendResponse,
        intent: &SendTextIntent<'_>,
    ) -> Result<ChatCommand, String> {
        self.prepare_direct_text_with_bootstraps(plan, intent, &[])
    }

    pub fn prepare_direct_text_with_bootstraps(
        &self,
        plan: &PrepareMessagingSendResponse,
        intent: &SendTextIntent<'_>,
        bootstraps: &[DirectSessionBootstrap],
    ) -> Result<ChatCommand, String> {
        validate_send_context(plan, intent, &self.endpoint, ConversationKind::Direct)?;
        self.store.validate_sender_attachments_ready(
            intent.conversation_id,
            intent.message_id,
            intent.attachments,
        )?;
        validate_authority_head(&self.store, plan)?;
        let local = model_endpoint(&self.endpoint);
        let peers = plan
            .required_endpoints
            .iter()
            .filter(|endpoint| **endpoint != local)
            .map(|endpoint| {
                SessionEndpoint::new(endpoint.ptid.clone(), endpoint.device_id.clone())
                    .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut sessions = Vec::with_capacity(peers.len());
        for peer in &peers {
            if let Some(bootstrap) = bootstraps.iter().find(|bootstrap| {
                bootstrap.session.key.conversation_id == intent.conversation_id
                    && bootstrap.session.key.peer == *peer
            }) {
                sessions.push((
                    bootstrap.session.clone(),
                    Some(bootstrap.session_init.clone()),
                ));
            } else {
                let mut existing = self.store.load_direct_sessions_for_peers(
                    intent.conversation_id,
                    std::slice::from_ref(peer),
                )?;
                let session = existing
                    .pop()
                    .ok_or_else(|| "messaging Direct session disappeared".to_string())?;
                let session_init = self
                    .store
                    .load_direct_session_bootstrap(&session.session_id)?
                    .map(|bytes| {
                        DirectSessionInit::decode(bytes.as_slice()).map_err(|_| {
                            "messaging Direct stored session init is invalid".to_string()
                        })
                    })
                    .transpose()?;
                sessions.push((session, session_init));
            }
        }
        if sessions.len() != peers.len() || bootstraps.len() > peers.len() {
            return Err("messaging Direct bootstrap endpoint set mismatch".to_string());
        }
        let mut advanced_sessions = Vec::with_capacity(sessions.len());
        let mut session_inits = Vec::new();
        let mut payloads = Vec::with_capacity(sessions.len());
        let private_content = encode_message_private_content(intent.plaintext, intent.attachments)?;
        for (mut session, session_init) in sessions {
            if session.key.local.ptid != self.endpoint.ptid
                || session.key.local.device_id != self.endpoint.device_id
            {
                return Err("messaging Direct session local endpoint mismatch".to_string());
            }
            let sender = local.clone();
            let recipient = CryptoEndpoint {
                ptid: session.key.peer.ptid.clone(),
                device_id: session.key.peer.device_id.clone(),
            };
            let mut direct = DirectDeviceCiphertext {
                command_id: intent.command_id.to_string(),
                message_id: intent.message_id.to_string(),
                sender: Some(sender.clone()),
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
            let ratchet_ciphertext = ratchet_proto(&wire);
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
        let command = build_text_command(
            plan,
            intent,
            &self.endpoint,
            payloads,
            Vec::new(),
            Vec::new(),
        )?;
        let command_bytes = command.encode_to_vec();
        self.store.persist_direct_send(&DirectSendCommit {
            command_bytes: &command_bytes,
            advanced_sessions: &advanced_sessions,
            session_inits: &session_inits,
            projection: pending_projection(
                intent,
                &self.endpoint,
                plan.conversation_kind,
                &plan.delivery_plan_sha256,
                &private_content,
            ),
        })?;
        Ok(command)
    }

    pub fn prepare_direct_edit_with_bootstraps(
        &self,
        plan: &PrepareMessagingSendResponse,
        intent: &EditTextIntent<'_>,
        bootstraps: &[DirectSessionBootstrap],
    ) -> Result<ChatCommand, String> {
        validate_edit_context(plan, intent, &self.endpoint, ConversationKind::Direct)?;
        validate_authority_head(&self.store, plan)?;
        let local = model_endpoint(&self.endpoint);
        let peers = plan
            .required_endpoints
            .iter()
            .filter(|endpoint| **endpoint != local)
            .map(|endpoint| {
                SessionEndpoint::new(endpoint.ptid.clone(), endpoint.device_id.clone())
                    .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut sessions = Vec::with_capacity(peers.len());
        for peer in &peers {
            if let Some(bootstrap) = bootstraps.iter().find(|bootstrap| {
                bootstrap.session.key.conversation_id == intent.conversation_id
                    && bootstrap.session.key.peer == *peer
            }) {
                sessions.push((
                    bootstrap.session.clone(),
                    Some(bootstrap.session_init.clone()),
                ));
            } else {
                let mut existing = self.store.load_direct_sessions_for_peers(
                    intent.conversation_id,
                    std::slice::from_ref(peer),
                )?;
                let session = existing
                    .pop()
                    .ok_or_else(|| "messaging Direct session disappeared".to_string())?;
                let session_init = self
                    .store
                    .load_direct_session_bootstrap(&session.session_id)?
                    .map(|bytes| {
                        DirectSessionInit::decode(bytes.as_slice()).map_err(|_| {
                            "messaging Direct stored session init is invalid".to_string()
                        })
                    })
                    .transpose()?;
                sessions.push((session, session_init));
            }
        }
        if sessions.len() != peers.len() || bootstraps.len() > peers.len() {
            return Err("messaging Direct bootstrap endpoint set mismatch".to_string());
        }
        let private_content = encode_message_private_content(intent.plaintext, &[])?;
        let mut advanced_sessions = Vec::with_capacity(sessions.len());
        let mut session_inits = Vec::new();
        let mut payloads = Vec::with_capacity(sessions.len());
        for (mut session, session_init) in sessions {
            if session.key.local.ptid != self.endpoint.ptid
                || session.key.local.device_id != self.endpoint.device_id
            {
                return Err("messaging Direct session local endpoint mismatch".to_string());
            }
            let recipient = CryptoEndpoint {
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
                .map_err(|error| format!("messaging Direct edit encrypt failed: {error}"))?;
            session.established = true;
            session.updated_at_unix_ms = intent.client_timestamp_unix_ms;
            let ratchet_ciphertext = ratchet_proto(&wire);
            direct.ciphertext_sha256 = Sha256::digest(ratchet_ciphertext.encode_to_vec()).to_vec();
            direct.ratchet_ciphertext = Some(ratchet_ciphertext);
            let endpoint_payload = direct.encode_to_vec();
            payloads.push(PreparedEndpointPayload {
                recipient: Some(recipient),
                kind: PreparedEndpointPayloadKind::DirectCiphertext as i32,
                payload_sha256: Sha256::digest(&endpoint_payload).to_vec(),
                opaque_payload: endpoint_payload,
            });
            advanced_sessions.push(session);
        }
        let command = build_edit_command(
            plan,
            intent,
            &self.endpoint,
            payloads,
            Vec::new(),
            Vec::new(),
        );
        let command_bytes = command.encode_to_vec();
        self.store.persist_direct_interaction_command(
            &InteractionCommandCommit {
                command_id: intent.command_id,
                conversation_id: intent.conversation_id,
                target_message_id: intent.message_id,
                interaction_kind: "edit",
                edited_text: Some(intent.plaintext),
                command_bytes: &command_bytes,
                delivery_plan_sha256: &plan.delivery_plan_sha256,
                created_at_unix_ms: intent.client_timestamp_unix_ms,
            },
            &advanced_sessions,
            &session_inits,
        )?;
        Ok(command)
    }

    pub fn prepare_group_text(
        &self,
        plan: &PrepareMessagingSendResponse,
        intent: &SendTextIntent<'_>,
    ) -> Result<ChatCommand, String> {
        validate_send_context(plan, intent, &self.endpoint, ConversationKind::Group)?;
        self.store.validate_sender_attachments_ready(
            intent.conversation_id,
            intent.message_id,
            intent.attachments,
        )?;
        validate_authority_head(&self.store, plan)?;
        let expected_mls_epoch = u64::try_from(plan.mls_epoch)
            .map_err(|_| "messaging MLS epoch is invalid".to_string())?;
        let private_content = encode_message_private_content(intent.plaintext, intent.attachments)?;
        let prepared = self.mls_manager.prepare_outbound_application(
            intent.conversation_id,
            expected_mls_epoch,
            &private_content,
        )?;
        if prepared.mls_epoch != expected_mls_epoch {
            return Err("messaging prepared MLS epoch mismatch".to_string());
        }
        let payload_hash = Sha256::digest(&prepared.ciphertext).to_vec();
        let command = build_text_command(
            plan,
            intent,
            &self.endpoint,
            Vec::new(),
            prepared.ciphertext.clone(),
            payload_hash,
        )?;
        let command_bytes = command.encode_to_vec();
        self.store.persist_mls_send(&MlsSendCommit {
            command_bytes: &command_bytes,
            session_state: &prepared.session_state,
            membership_epoch: plan.membership_epoch,
            mls_epoch: plan.mls_epoch,
            projection: pending_projection(
                intent,
                &self.endpoint,
                plan.conversation_kind,
                &plan.delivery_plan_sha256,
                &private_content,
            ),
        })?;
        self.mls_manager
            .install_prepared_outbound_application(intent.conversation_id, &prepared)?;
        Ok(command)
    }

    pub fn prepare_group_edit(
        &self,
        plan: &PrepareMessagingSendResponse,
        intent: &EditTextIntent<'_>,
    ) -> Result<ChatCommand, String> {
        validate_edit_context(plan, intent, &self.endpoint, ConversationKind::Group)?;
        validate_authority_head(&self.store, plan)?;
        let expected_mls_epoch = u64::try_from(plan.mls_epoch)
            .map_err(|_| "messaging MLS epoch is invalid".to_string())?;
        let private_content = encode_message_private_content(intent.plaintext, &[])?;
        let prepared = self.mls_manager.prepare_outbound_application(
            intent.conversation_id,
            expected_mls_epoch,
            &private_content,
        )?;
        if prepared.mls_epoch != expected_mls_epoch {
            return Err("messaging prepared MLS epoch mismatch".to_string());
        }
        let payload_hash = Sha256::digest(&prepared.ciphertext).to_vec();
        let command = build_edit_command(
            plan,
            intent,
            &self.endpoint,
            Vec::new(),
            prepared.ciphertext.clone(),
            payload_hash,
        );
        let command_bytes = command.encode_to_vec();
        self.store.persist_mls_interaction_command(
            &InteractionCommandCommit {
                command_id: intent.command_id,
                conversation_id: intent.conversation_id,
                target_message_id: intent.message_id,
                interaction_kind: "edit",
                edited_text: Some(intent.plaintext),
                command_bytes: &command_bytes,
                delivery_plan_sha256: &plan.delivery_plan_sha256,
                created_at_unix_ms: intent.client_timestamp_unix_ms,
            },
            &prepared.session_state,
            plan.membership_epoch,
            plan.mls_epoch,
        )?;
        self.mls_manager
            .install_prepared_outbound_application(intent.conversation_id, &prepared)?;
        Ok(command)
    }
}

fn validate_send_context(
    plan: &PrepareMessagingSendResponse,
    intent: &SendTextIntent<'_>,
    endpoint: &EngineEndpoint,
    expected_kind: ConversationKind,
) -> Result<(), String> {
    let private_content = encode_message_private_content(intent.plaintext, intent.attachments)?;
    if intent.command_id.trim().is_empty()
        || intent.message_id.trim().is_empty()
        || intent.conversation_id.trim().is_empty()
        || intent.client_timestamp_unix_ms <= 0
        || plan.conversation_id != intent.conversation_id
        || plan.authority_station_id.trim().is_empty()
        || plan.delivery_plan_sha256.len() != 32
        || plan.membership_epoch < 0
        || plan.mls_epoch < 0
        || ConversationKind::try_from(plan.conversation_kind)
            .map_err(|_| "messaging send plan kind is invalid".to_string())?
            != expected_kind
    {
        return Err("messaging send context is incomplete".to_string());
    }
    if private_content.is_empty() {
        return Err("messaging private content is empty".to_string());
    }
    let local = model_endpoint(endpoint);
    let mut previous: Option<(&str, &str)> = None;
    let mut local_count = 0;
    for required in &plan.required_endpoints {
        if required.ptid.trim().is_empty() || required.device_id.trim().is_empty() {
            return Err("messaging send plan has incomplete endpoint".to_string());
        }
        let key = (required.ptid.as_str(), required.device_id.as_str());
        if previous.is_some_and(|value| value >= key) {
            return Err("messaging send plan endpoints are not strictly sorted".to_string());
        }
        previous = Some(key);
        if required == &local {
            local_count += 1;
        }
    }
    if local_count != 1 || plan.required_endpoints.len() < 2 {
        return Err("messaging send plan does not contain the sending endpoint".to_string());
    }
    Ok(())
}

fn validate_edit_context(
    plan: &PrepareMessagingSendResponse,
    intent: &EditTextIntent<'_>,
    endpoint: &EngineEndpoint,
    expected_kind: ConversationKind,
) -> Result<(), String> {
    validate_send_context(
        plan,
        &SendTextIntent {
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
        expected_kind,
    )
}

fn validate_authority_head(
    store: &MessagingStore,
    plan: &PrepareMessagingSendResponse,
) -> Result<(), String> {
    let (local_sequence, local_hash) = store.authority_head(&plan.conversation_id)?;
    if local_sequence != plan.authority_sequence || local_hash != plan.authority_hash {
        return Err("messaging local authority head is behind send plan".to_string());
    }
    Ok(())
}

fn build_text_command(
    plan: &PrepareMessagingSendResponse,
    intent: &SendTextIntent<'_>,
    endpoint: &EngineEndpoint,
    direct_payloads: Vec<PreparedEndpointPayload>,
    mls_payload: Vec<u8>,
    mls_payload_sha256: Vec<u8>,
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
        sender: Some(model_endpoint(endpoint)),
        observed_membership_epoch: plan.membership_epoch,
        observed_mls_epoch: plan.mls_epoch,
        client_timestamp: Some(prost_types::Timestamp {
            seconds: intent.client_timestamp_unix_ms.div_euclid(1_000),
            nanos: (intent.client_timestamp_unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
        }),
        delivery_plan_sha256: plan.delivery_plan_sha256.clone(),
        authority_station_id: plan.authority_station_id.clone(),
        payload: Some(chat_command::Payload::SendMessage(SendMessageIntent {
            message_id: intent.message_id.to_string(),
            content_kind: MessagingContentKind::Text as i32,
            reply_to_message_id: intent.reply_to_message_id.to_string(),
            thread_root_message_id: intent.thread_root_message_id.to_string(),
            attachments,
            direct_payloads,
            mls_application_payload: mls_payload,
            mls_application_payload_sha256: mls_payload_sha256,
        })),
    })
}

fn build_edit_command(
    plan: &PrepareMessagingSendResponse,
    intent: &EditTextIntent<'_>,
    endpoint: &EngineEndpoint,
    direct_payloads: Vec<PreparedEndpointPayload>,
    mls_payload: Vec<u8>,
    mls_payload_sha256: Vec<u8>,
) -> ChatCommand {
    ChatCommand {
        command_id: intent.command_id.to_string(),
        conversation_id: intent.conversation_id.to_string(),
        sender: Some(model_endpoint(endpoint)),
        observed_membership_epoch: plan.membership_epoch,
        observed_mls_epoch: plan.mls_epoch,
        client_timestamp: Some(prost_types::Timestamp {
            seconds: intent.client_timestamp_unix_ms.div_euclid(1_000),
            nanos: (intent.client_timestamp_unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
        }),
        delivery_plan_sha256: plan.delivery_plan_sha256.clone(),
        authority_station_id: plan.authority_station_id.clone(),
        payload: Some(chat_command::Payload::EditMessage(EditMessageIntent {
            message_id: intent.message_id.to_string(),
            direct_payloads,
            mls_application_payload: mls_payload,
            mls_application_payload_sha256: mls_payload_sha256,
        })),
    }
}

fn pending_projection<'a>(
    intent: &'a SendTextIntent<'a>,
    endpoint: &'a EngineEndpoint,
    conversation_kind: i32,
    delivery_plan_sha256: &'a [u8],
    private_content: &'a [u8],
) -> PendingSenderProjection<'a> {
    PendingSenderProjection {
        command_id: intent.command_id,
        conversation_id: intent.conversation_id,
        conversation_kind,
        message_id: intent.message_id,
        sender_ptid: &endpoint.ptid,
        sender_device_id: &endpoint.device_id,
        plaintext: intent.plaintext,
        reply_to_message_id: intent.reply_to_message_id,
        thread_root_message_id: intent.thread_root_message_id,
        attachments: intent.attachments,
        private_content,
        delivery_plan_sha256,
        created_at_unix_ms: intent.client_timestamp_unix_ms,
    }
}

fn model_endpoint(endpoint: &EngineEndpoint) -> CryptoEndpoint {
    CryptoEndpoint {
        ptid: endpoint.ptid.clone(),
        device_id: endpoint.device_id.clone(),
    }
}

fn ratchet_proto(wire: &DrCiphertextWire) -> DoubleRatchetCiphertext {
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
    use crate::domain::crypto::double_ratchet::DrSessionState;
    use crate::domain::crypto::{DirectSession, DirectSessionKey};
    use crate::domain::mls_group::MlsMemberKeyPackage;
    use crate::messaging::private_content::test_attachment_metadata;
    use crate::messaging::{decode_message_private_content, AttachmentTransferRecord};
    use crate::model::chat::{AttachmentTransferState, EncryptedObjectUploadSpec};

    fn session(peer_ptid: &str, peer_device_id: &str, seed: u8) -> DirectSession {
        let session_id = format!("session-{peer_ptid}-{peer_device_id}");
        DirectSession {
            session_id: session_id.clone(),
            key: DirectSessionKey::new(
                "conversation-1",
                SessionEndpoint::new("ptid:alice", "alice-device").unwrap(),
                SessionEndpoint::new(peer_ptid, peer_device_id).unwrap(),
                1,
            )
            .unwrap(),
            protocol_version: 1,
            established: true,
            peer_identity_key: [seed; 32],
            ratchet: DrSessionState {
                session_id,
                root_key: [seed + 1; 32],
                self_priv: [seed + 2; 32],
                self_pub: [seed + 3; 32],
                peer_pub: Some([seed + 4; 32]),
                send_chain_key: Some([seed + 5; 32]),
                recv_chain_key: Some([seed + 6; 32]),
                n_send: 0,
                n_recv: 0,
                n_prev: 0,
            },
            updated_at_unix_ms: 10,
        }
    }

    fn install_completed_upload(
        store: &MessagingStore,
        conversation_id: &str,
        message_id: &str,
        authority_station_id: &str,
        attachment: &AttachmentPlaintextMetadata,
    ) {
        let object = attachment.object.as_ref().unwrap();
        let upload_spec = EncryptedObjectUploadSpec {
            ciphertext_size: object.ciphertext_size,
            ciphertext_sha256: object.ciphertext_sha256.clone(),
            media_type: object.media_type.clone(),
            chunk_size: object.chunk_size,
            chunk_count: object.chunk_count,
            encryption_suite: object.encryption_suite,
            tag_size: object.tag_size,
            nonce_strategy: object.nonce_strategy,
            chunk_ciphertext_sha256: object.chunk_ciphertext_sha256.clone(),
        };
        let descriptor_sha256 = crate::messaging::attachment_transfer::upload_commitment_fields(
            conversation_id,
            message_id,
            &attachment.attachment_id,
            authority_station_id,
            &upload_spec,
        )
        .to_vec();
        let mut completed_chunk_bitmap = vec![0; object.chunk_count.div_ceil(8) as usize];
        for chunk_index in 0..object.chunk_count {
            completed_chunk_bitmap[chunk_index as usize / 8] |= 1 << (chunk_index % 8);
        }
        store
            .create_attachment_transfer(&AttachmentTransferRecord {
                attachment_id: attachment.attachment_id.clone(),
                conversation_id: conversation_id.to_string(),
                message_id: message_id.to_string(),
                authority_station_id: authority_station_id.to_string(),
                direction: 1,
                state: AttachmentTransferState::Complete as i32,
                upload_id: format!("upload-{}", attachment.attachment_id),
                generation: 1,
                descriptor_sha256,
                completed_chunk_bitmap,
                source_local_ref: format!("/tmp/source-{}", attachment.attachment_id),
                partial_local_ref: String::new(),
                object_key: attachment.object_key.clone(),
                base_nonce: attachment.base_nonce.clone(),
                plaintext_size: attachment.plaintext_size,
                chunk_size: object.chunk_size,
                attempt_count: 0,
                next_attempt_at_unix_ms: 1,
                last_error_code: 0,
                updated_at_unix_ms: 1,
            })
            .unwrap();
    }

    fn decrypt_direct_payload(
        payload: &PreparedEndpointPayload,
        conversation_id: &str,
        seed: u8,
    ) -> crate::model::chat::MessagePrivateContent {
        let direct = DirectDeviceCiphertext::decode(payload.opaque_payload.as_slice()).unwrap();
        let ratchet = direct.ratchet_ciphertext.as_ref().unwrap();
        let wire = DrCiphertextWire {
            version: ratchet.wire_version,
            sender_dh: ratchet
                .sender_ratchet_public_key
                .as_slice()
                .try_into()
                .unwrap(),
            n_send: ratchet.message_counter,
            n_prev: ratchet.previous_chain_length,
            nonce: ratchet.nonce.as_slice().try_into().unwrap(),
            ciphertext: ratchet.ciphertext.clone(),
        };
        let receiver = DrSessionState {
            session_id: direct.session_id.clone(),
            root_key: [seed + 1; 32],
            self_priv: [seed + 7; 32],
            self_pub: [seed + 8; 32],
            peer_pub: Some([seed + 3; 32]),
            send_chain_key: None,
            recv_chain_key: Some([seed + 5; 32]),
            n_send: 0,
            n_recv: 0,
            n_prev: 0,
        };
        let aad = DirectCiphertextAad {
            command_id: direct.command_id,
            message_id: direct.message_id,
            conversation_id: conversation_id.to_string(),
            sender: direct.sender,
            recipient: direct.recipient,
            session_id: direct.session_id,
            session_generation: direct.session_generation,
            protocol_version: direct.protocol_version,
        }
        .encode_to_vec();
        let outcome = double_ratchet::decrypt(&receiver, &wire, &[], &aad).unwrap();
        decode_message_private_content(&outcome.plaintext).unwrap()
    }

    #[test]
    fn direct_prepare_persists_exact_command_and_one_ciphertext_per_plan_endpoint() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .save_direct_session(&session("ptid:alice", "alice-phone", 10))
            .unwrap();
        store
            .save_direct_session(&session("ptid:bob", "bob-device", 30))
            .unwrap();
        let preparer = SendPreparer::new(
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            Arc::new(MlsGroupManager::new()),
        )
        .unwrap();
        let mut plan = PrepareMessagingSendResponse {
            conversation_id: "conversation-1".to_string(),
            conversation_kind: ConversationKind::Direct as i32,
            authority_sequence: 0,
            authority_hash: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 0,
            required_endpoints: vec![
                CryptoEndpoint {
                    ptid: "ptid:alice".to_string(),
                    device_id: "alice-device".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:alice".to_string(),
                    device_id: "alice-phone".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                },
            ],
            delivery_plan_sha256: vec![9; 32],
            endpoint_manifests: Vec::new(),
            authority_station_id: "station-local".to_string(),
        };
        let attachment = test_attachment_metadata("attachment-1");
        let rejected = preparer
            .prepare_direct_text(
                &plan,
                &SendTextIntent {
                    command_id: "command-incomplete-upload",
                    message_id: "message-1",
                    conversation_id: "conversation-1",
                    plaintext: "exact plaintext",
                    reply_to_message_id: "",
                    thread_root_message_id: "",
                    attachments: std::slice::from_ref(&attachment),
                    client_timestamp_unix_ms: 99,
                },
            )
            .unwrap_err();
        assert_eq!(
            rejected,
            "messaging attachment is not durably complete for send"
        );
        assert!(store.next_command(99).unwrap().is_none());
        install_completed_upload(
            &store,
            "conversation-1",
            "message-1",
            "station-local",
            &attachment,
        );
        let command = preparer
            .prepare_direct_text(
                &plan,
                &SendTextIntent {
                    command_id: "command-1",
                    message_id: "message-1",
                    conversation_id: "conversation-1",
                    plaintext: "exact plaintext",
                    reply_to_message_id: "",
                    thread_root_message_id: "",
                    attachments: std::slice::from_ref(&attachment),
                    client_timestamp_unix_ms: 100,
                },
            )
            .unwrap();
        assert_eq!(command.delivery_plan_sha256, plan.delivery_plan_sha256);
        let send = match command.payload.as_ref().unwrap() {
            chat_command::Payload::SendMessage(send) => send,
            _ => panic!("unexpected command payload"),
        };
        assert_eq!(send.attachments, vec![attachment.object.clone().unwrap()]);
        assert_eq!(send.direct_payloads.len(), 2);
        assert_eq!(
            send.direct_payloads
                .iter()
                .map(|payload| payload.recipient.clone().unwrap())
                .collect::<Vec<_>>(),
            plan.required_endpoints[1..]
        );
        let bob_payload = send
            .direct_payloads
            .iter()
            .find(|payload| payload.recipient.as_ref().unwrap().ptid == "ptid:bob")
            .unwrap();
        let private_content = decrypt_direct_payload(bob_payload, "conversation-1", 30);
        assert_eq!(private_content.text, "exact plaintext");
        assert_eq!(private_content.attachments, vec![attachment.clone()]);
        assert_eq!(
            store.next_command(100).unwrap().unwrap().command_bytes,
            command.encode_to_vec()
        );
        assert_eq!(
            store
                .load_direct_session("session-ptid:alice-alice-phone")
                .unwrap()
                .unwrap()
                .ratchet
                .n_send,
            1
        );
        assert_eq!(
            store
                .load_direct_session("session-ptid:bob-bob-device")
                .unwrap()
                .unwrap()
                .ratchet
                .n_send,
            1
        );
        store
            .mark_command_superseded("command-1", &command.encode_to_vec(), 0)
            .unwrap();
        let reloaded = store.next_due_message_draft(100).unwrap().unwrap();
        assert_eq!(reloaded.attachments, vec![attachment.clone()]);
        plan.delivery_plan_sha256 = vec![10; 32];
        let replacement = preparer
            .prepare_direct_text(
                &plan,
                &SendTextIntent {
                    command_id: "command-2",
                    message_id: &reloaded.message_id,
                    conversation_id: &reloaded.conversation_id,
                    plaintext: &reloaded.plaintext,
                    reply_to_message_id: &reloaded.reply_to_message_id,
                    thread_root_message_id: &reloaded.thread_root_message_id,
                    attachments: &reloaded.attachments,
                    client_timestamp_unix_ms: 110,
                },
            )
            .unwrap();
        assert_eq!(
            store.next_command(110).unwrap().unwrap().command_id,
            "command-2"
        );
        assert_ne!(command.encode_to_vec(), replacement.encode_to_vec());
        assert_eq!(
            store
                .load_direct_session("session-ptid:bob-bob-device")
                .unwrap()
                .unwrap()
                .ratchet
                .n_send,
            2
        );
    }

    #[test]
    fn direct_edit_atomically_advances_ratchet_and_persists_exact_interaction() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        store
            .save_direct_session(&session("ptid:bob", "bob-device", 30))
            .unwrap();
        let preparer = SendPreparer::new(
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            Arc::new(MlsGroupManager::new()),
        )
        .unwrap();
        let plan = PrepareMessagingSendResponse {
            conversation_id: "conversation-1".to_string(),
            conversation_kind: ConversationKind::Direct as i32,
            authority_sequence: 0,
            authority_hash: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 0,
            required_endpoints: vec![
                CryptoEndpoint {
                    ptid: "ptid:alice".to_string(),
                    device_id: "alice-device".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                },
            ],
            delivery_plan_sha256: vec![9; 32],
            endpoint_manifests: Vec::new(),
            authority_station_id: "station-local".to_string(),
        };
        let command = preparer
            .prepare_direct_edit_with_bootstraps(
                &plan,
                &EditTextIntent {
                    command_id: "edit-command-1",
                    message_id: "message-1",
                    conversation_id: "conversation-1",
                    plaintext: "edited plaintext",
                    client_timestamp_unix_ms: 100,
                },
                &[],
            )
            .unwrap();
        let edit = match command.payload.as_ref().unwrap() {
            chat_command::Payload::EditMessage(edit) => edit,
            _ => panic!("unexpected command payload"),
        };
        assert_eq!(edit.message_id, "message-1");
        assert_eq!(edit.direct_payloads.len(), 1);
        assert_eq!(
            decrypt_direct_payload(&edit.direct_payloads[0], "conversation-1", 30).text,
            "edited plaintext"
        );
        assert_eq!(
            store.next_command(100).unwrap().unwrap().command_bytes,
            command.encode_to_vec()
        );
        assert_eq!(
            store
                .load_direct_session("session-ptid:bob-bob-device")
                .unwrap()
                .unwrap()
                .ratchet
                .n_send,
            1
        );
    }

    #[test]
    fn group_edit_atomically_advances_mls_and_persists_exact_interaction() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let alice = Arc::new(MlsGroupManager::new());
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let created = alice
            .create_group(
                "group-1",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob.generate_key_package().unwrap(),
                }],
            )
            .unwrap();
        alice
            .accept_pending_transition("group-1", &created.transition_id)
            .unwrap();
        bob.join_group("group-1", &created.welcome_bytes).unwrap();
        let preparer = SendPreparer::new(
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            alice,
        )
        .unwrap();
        let plan = PrepareMessagingSendResponse {
            conversation_id: "group-1".to_string(),
            conversation_kind: ConversationKind::Group as i32,
            authority_sequence: 0,
            authority_hash: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 1,
            required_endpoints: vec![
                CryptoEndpoint {
                    ptid: "ptid:alice".to_string(),
                    device_id: "alice-device".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                },
            ],
            delivery_plan_sha256: vec![8; 32],
            endpoint_manifests: Vec::new(),
            authority_station_id: "station-local".to_string(),
        };
        let command = preparer
            .prepare_group_edit(
                &plan,
                &EditTextIntent {
                    command_id: "edit-command-1",
                    message_id: "message-1",
                    conversation_id: "group-1",
                    plaintext: "group edited plaintext",
                    client_timestamp_unix_ms: 100,
                },
            )
            .unwrap();
        let edit = match command.payload.as_ref().unwrap() {
            chat_command::Payload::EditMessage(edit) => edit,
            _ => panic!("unexpected command payload"),
        };
        assert!(edit.direct_payloads.is_empty());
        assert_eq!(
            edit.mls_application_payload_sha256,
            Sha256::digest(&edit.mls_application_payload).to_vec()
        );
        let received = bob
            .prepare_application_message("group-1", &edit.mls_application_payload)
            .unwrap();
        assert_eq!(
            decode_message_private_content(&received.plaintext)
                .unwrap()
                .text,
            "group edited plaintext"
        );
        assert_eq!(
            store.next_command(100).unwrap().unwrap().command_bytes,
            command.encode_to_vec()
        );
        assert!(store.load_mls_session_state("group-1").unwrap().is_some());
    }

    #[test]
    fn group_prepare_persists_attachment_only_private_content_and_public_descriptor() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let alice = Arc::new(MlsGroupManager::new());
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:alice", "alice-device")
            .unwrap();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let created = alice
            .create_group(
                "group-1",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob.generate_key_package().unwrap(),
                }],
            )
            .unwrap();
        alice
            .accept_pending_transition("group-1", &created.transition_id)
            .unwrap();
        bob.join_group("group-1", &created.welcome_bytes).unwrap();
        let preparer = SendPreparer::new(
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            alice,
        )
        .unwrap();
        let plan = PrepareMessagingSendResponse {
            conversation_id: "group-1".to_string(),
            conversation_kind: ConversationKind::Group as i32,
            authority_sequence: 0,
            authority_hash: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 1,
            required_endpoints: vec![
                CryptoEndpoint {
                    ptid: "ptid:alice".to_string(),
                    device_id: "alice-device".to_string(),
                },
                CryptoEndpoint {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                },
            ],
            delivery_plan_sha256: vec![8; 32],
            endpoint_manifests: Vec::new(),
            authority_station_id: "station-local".to_string(),
        };
        let attachment = test_attachment_metadata("group-attachment-1");
        install_completed_upload(
            &store,
            "group-1",
            "group-message-1",
            "station-local",
            &attachment,
        );
        let command = preparer
            .prepare_group_text(
                &plan,
                &SendTextIntent {
                    command_id: "group-command-1",
                    message_id: "group-message-1",
                    conversation_id: "group-1",
                    plaintext: "",
                    reply_to_message_id: "",
                    thread_root_message_id: "",
                    attachments: std::slice::from_ref(&attachment),
                    client_timestamp_unix_ms: 100,
                },
            )
            .unwrap();
        let send = match command.payload.as_ref().unwrap() {
            chat_command::Payload::SendMessage(send) => send,
            _ => panic!("unexpected command payload"),
        };
        assert!(send.direct_payloads.is_empty());
        assert_eq!(send.attachments, vec![attachment.object.clone().unwrap()]);
        assert_eq!(
            Sha256::digest(&send.mls_application_payload).as_slice(),
            send.mls_application_payload_sha256
        );
        let decrypted = bob
            .decrypt("group-1", &send.mls_application_payload)
            .unwrap();
        let private_content = decode_message_private_content(&decrypted).unwrap();
        assert!(private_content.text.is_empty());
        assert_eq!(private_content.attachments, vec![attachment]);
        assert_eq!(
            store.next_command(100).unwrap().unwrap().command_bytes,
            command.encode_to_vec()
        );
        assert!(store.load_mls_session_state("group-1").unwrap().is_some());
    }
}
