use super::{EngineEndpoint, MessagingStore};
use crate::model::chat::{
    AttachmentPlaintextMetadata, ChatCommand, CryptoEndpoint, PrepareMessagingSendResponse,
};
use messaging_core::mls::group::MlsGroupManager;
use messaging_core::mls::outbound::{
    GroupEditTextIntent, GroupSendTextIntent, MlsOutboundPreparer,
};
pub use messaging_core::outbox::DirectSessionBootstrap;
use messaging_core::outbox::{DirectEditIntent, DirectOutboundPreparer, DirectSendIntent};
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
        DirectOutboundPreparer::new(self.store.clone(), model_endpoint(&self.endpoint))?
            .prepare_send(
                plan,
                &DirectSendIntent {
                    command_id: intent.command_id,
                    message_id: intent.message_id,
                    conversation_id: intent.conversation_id,
                    plaintext: intent.plaintext,
                    reply_to_message_id: intent.reply_to_message_id,
                    thread_root_message_id: intent.thread_root_message_id,
                    attachments: intent.attachments,
                    client_timestamp_unix_ms: intent.client_timestamp_unix_ms,
                },
                bootstraps,
            )
    }

    pub fn prepare_direct_edit_with_bootstraps(
        &self,
        plan: &PrepareMessagingSendResponse,
        intent: &EditTextIntent<'_>,
        bootstraps: &[DirectSessionBootstrap],
    ) -> Result<ChatCommand, String> {
        DirectOutboundPreparer::new(self.store.clone(), model_endpoint(&self.endpoint))?
            .prepare_edit(
                plan,
                &DirectEditIntent {
                    command_id: intent.command_id,
                    message_id: intent.message_id,
                    conversation_id: intent.conversation_id,
                    plaintext: intent.plaintext,
                    client_timestamp_unix_ms: intent.client_timestamp_unix_ms,
                },
                bootstraps,
            )
    }

    pub fn prepare_group_text(
        &self,
        plan: &PrepareMessagingSendResponse,
        intent: &SendTextIntent<'_>,
    ) -> Result<ChatCommand, String> {
        MlsOutboundPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            model_endpoint(&self.endpoint),
        )?
        .prepare_send(
            plan,
            &GroupSendTextIntent {
                command_id: intent.command_id,
                message_id: intent.message_id,
                conversation_id: intent.conversation_id,
                plaintext: intent.plaintext,
                reply_to_message_id: intent.reply_to_message_id,
                thread_root_message_id: intent.thread_root_message_id,
                attachments: intent.attachments,
                client_timestamp_unix_ms: intent.client_timestamp_unix_ms,
            },
        )
    }

    pub fn prepare_group_edit(
        &self,
        plan: &PrepareMessagingSendResponse,
        intent: &EditTextIntent<'_>,
    ) -> Result<ChatCommand, String> {
        MlsOutboundPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            model_endpoint(&self.endpoint),
        )?
        .prepare_edit(
            plan,
            &GroupEditTextIntent {
                command_id: intent.command_id,
                message_id: intent.message_id,
                conversation_id: intent.conversation_id,
                plaintext: intent.plaintext,
                client_timestamp_unix_ms: intent.client_timestamp_unix_ms,
            },
        )
    }
}

fn model_endpoint(endpoint: &EngineEndpoint) -> CryptoEndpoint {
    CryptoEndpoint {
        ptid: endpoint.ptid.clone(),
        device_id: endpoint.device_id.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::crypto::double_ratchet::DrSessionState;
    use crate::domain::crypto::{
        CryptoEndpoint as SessionEndpoint, DirectSession, DirectSessionKey,
    };
    use crate::messaging::private_content::test_attachment_metadata;
    use crate::messaging::{decode_message_private_content, AttachmentTransferRecord};
    use crate::model::chat::{
        chat_command, AttachmentTransferState, ConversationKind, EncryptedObjectUploadSpec,
        PreparedEndpointPayload,
    };

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
}
