use super::group::MlsGroupManager;
use crate::codec::private_content::encode_message_private_content;
use crate::proto::actor_device_ptid;
use crate::proto::chat::{
    chat_command, AttachmentPlaintextMetadata, ChatCommand, ConversationKind, CryptoEndpoint,
    EditMessageIntent, ForwardMessageIntent, MessagingContentKind,
    PrepareConversationCommandResponse, SendMessageIntent,
};
use crate::store::{
    MlsOutboundEditCommit, MlsOutboundRepository, MlsOutboundSendCommit, PendingSenderProjection,
};
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub struct GroupSendTextIntent<'a> {
    pub command_id: &'a str,
    pub message_id: &'a str,
    pub conversation_id: &'a str,
    pub plaintext: &'a str,
    pub reply_to_message_id: &'a str,
    pub thread_root_message_id: &'a str,
    pub attachments: &'a [AttachmentPlaintextMetadata],
    pub client_timestamp_unix_ms: i64,
}

pub struct GroupEditTextIntent<'a> {
    pub command_id: &'a str,
    pub message_id: &'a str,
    pub conversation_id: &'a str,
    pub plaintext: &'a str,
    pub client_timestamp_unix_ms: i64,
}

pub struct GroupForwardIntent<'a> {
    pub command_id: &'a str,
    pub destination_message_id: &'a str,
    pub conversation_id: &'a str,
    pub plaintext: &'a str,
    pub attachments: &'a [AttachmentPlaintextMetadata],
    pub client_timestamp_unix_ms: i64,
}

pub struct MlsOutboundPreparer<R> {
    store: Arc<R>,
    manager: Arc<MlsGroupManager>,
    endpoint: CryptoEndpoint,
}

impl<R: MlsOutboundRepository> MlsOutboundPreparer<R> {
    pub fn new(
        store: Arc<R>,
        manager: Arc<MlsGroupManager>,
        endpoint: CryptoEndpoint,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging MLS outbound preparer requires complete endpoint".to_string());
        }
        Ok(Self {
            store,
            manager,
            endpoint,
        })
    }

    pub fn prepare_send(
        &self,
        plan: &PrepareConversationCommandResponse,
        intent: &GroupSendTextIntent<'_>,
    ) -> Result<ChatCommand, String> {
        validate_send_context(plan, intent, &self.endpoint)?;
        self.store.validate_sender_attachments_ready(
            intent.conversation_id,
            intent.message_id,
            intent.attachments,
        )?;
        validate_authority_head(self.store.as_ref(), plan)?;

        let expected_mls_epoch = u64::try_from(plan.mls_epoch)
            .map_err(|_| "messaging MLS epoch is invalid".to_string())?;
        let private_content = encode_message_private_content(intent.plaintext, intent.attachments)?;
        let prepared = self.manager.prepare_outbound_application(
            intent.conversation_id,
            expected_mls_epoch,
            &private_content,
        )?;
        if prepared.mls_epoch != expected_mls_epoch {
            return Err("messaging prepared MLS epoch mismatch".to_string());
        }

        let command = build_send_command(plan, intent, &self.endpoint, &prepared.ciphertext)?;
        let command_bytes = command.encode_to_vec();
        self.store
            .persist_mls_outbound_send(&MlsOutboundSendCommit {
                command_bytes: &command_bytes,
                expected_authority_sequence: plan.authority_sequence,
                expected_authority_hash: &plan.authority_hash,
                session_state: &prepared.session_state,
                membership_epoch: plan.membership_epoch,
                mls_epoch: plan.mls_epoch,
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
                    private_content: &private_content,
                    delivery_plan_sha256: &plan.delivery_plan_sha256,
                    created_at_unix_ms: intent.client_timestamp_unix_ms,
                },
            })?;
        self.manager
            .install_prepared_outbound_application(intent.conversation_id, &prepared)?;
        Ok(command)
    }

    pub fn prepare_edit(
        &self,
        plan: &PrepareConversationCommandResponse,
        intent: &GroupEditTextIntent<'_>,
    ) -> Result<ChatCommand, String> {
        validate_edit_context(plan, intent, &self.endpoint)?;
        validate_authority_head(self.store.as_ref(), plan)?;

        let expected_mls_epoch = u64::try_from(plan.mls_epoch)
            .map_err(|_| "messaging MLS epoch is invalid".to_string())?;
        let private_content = encode_message_private_content(intent.plaintext, &[])?;
        let prepared = self.manager.prepare_outbound_application(
            intent.conversation_id,
            expected_mls_epoch,
            &private_content,
        )?;
        if prepared.mls_epoch != expected_mls_epoch {
            return Err("messaging prepared MLS epoch mismatch".to_string());
        }

        let command = build_edit_command(plan, intent, &self.endpoint, &prepared.ciphertext);
        let command_bytes = command.encode_to_vec();
        self.store
            .persist_mls_outbound_edit(&MlsOutboundEditCommit {
                command_id: intent.command_id,
                conversation_id: intent.conversation_id,
                target_message_id: intent.message_id,
                edited_text: intent.plaintext,
                command_bytes: &command_bytes,
                delivery_plan_sha256: &plan.delivery_plan_sha256,
                expected_authority_sequence: plan.authority_sequence,
                expected_authority_hash: &plan.authority_hash,
                session_state: &prepared.session_state,
                membership_epoch: plan.membership_epoch,
                mls_epoch: plan.mls_epoch,
                created_at_unix_ms: intent.client_timestamp_unix_ms,
            })?;
        self.manager
            .install_prepared_outbound_application(intent.conversation_id, &prepared)?;
        Ok(command)
    }

    pub fn prepare_forward(
        &self,
        plan: &PrepareConversationCommandResponse,
        intent: &GroupForwardIntent<'_>,
    ) -> Result<ChatCommand, String> {
        let send = GroupSendTextIntent {
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

        let expected_mls_epoch = u64::try_from(plan.mls_epoch)
            .map_err(|_| "messaging MLS epoch is invalid".to_string())?;
        let private_content = encode_message_private_content(intent.plaintext, intent.attachments)?;
        let prepared = self.manager.prepare_outbound_application(
            intent.conversation_id,
            expected_mls_epoch,
            &private_content,
        )?;
        if prepared.mls_epoch != expected_mls_epoch {
            return Err("messaging prepared MLS epoch mismatch".to_string());
        }
        let command = build_forward_command(plan, intent, &self.endpoint, &prepared.ciphertext)?;
        let command_bytes = command.encode_to_vec();
        self.store
            .persist_mls_outbound_send(&MlsOutboundSendCommit {
                command_bytes: &command_bytes,
                expected_authority_sequence: plan.authority_sequence,
                expected_authority_hash: &plan.authority_hash,
                session_state: &prepared.session_state,
                membership_epoch: plan.membership_epoch,
                mls_epoch: plan.mls_epoch,
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
                    private_content: &private_content,
                    delivery_plan_sha256: &plan.delivery_plan_sha256,
                    created_at_unix_ms: intent.client_timestamp_unix_ms,
                },
            })?;
        self.manager
            .install_prepared_outbound_application(intent.conversation_id, &prepared)?;
        Ok(command)
    }
}

fn validate_send_context(
    plan: &PrepareConversationCommandResponse,
    intent: &GroupSendTextIntent<'_>,
    endpoint: &CryptoEndpoint,
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
            != ConversationKind::Group
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
    intent: &GroupEditTextIntent<'_>,
    endpoint: &CryptoEndpoint,
) -> Result<(), String> {
    validate_send_context(
        plan,
        &GroupSendTextIntent {
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

fn validate_authority_head<R: MlsOutboundRepository>(
    store: &R,
    plan: &PrepareConversationCommandResponse,
) -> Result<(), String> {
    let (local_sequence, local_hash) = store.authority_head(&plan.conversation_id)?;
    if local_sequence != plan.authority_sequence || local_hash != plan.authority_hash {
        return Err("messaging local authority head is behind send plan".to_string());
    }
    Ok(())
}

fn build_send_command(
    plan: &PrepareConversationCommandResponse,
    intent: &GroupSendTextIntent<'_>,
    endpoint: &CryptoEndpoint,
    mls_payload: &[u8],
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
            direct_payloads: Vec::new(),
            mls_application_payload: mls_payload.to_vec(),
            mls_application_payload_sha256: Sha256::digest(mls_payload).to_vec(),
        })),
    })
}

fn build_forward_command(
    plan: &PrepareConversationCommandResponse,
    intent: &GroupForwardIntent<'_>,
    endpoint: &CryptoEndpoint,
    mls_payload: &[u8],
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
                destination_payloads: Vec::new(),
                mls_application_payload: mls_payload.to_vec(),
                mls_application_payload_sha256: Sha256::digest(mls_payload).to_vec(),
            },
        )),
    })
}

fn build_edit_command(
    plan: &PrepareConversationCommandResponse,
    intent: &GroupEditTextIntent<'_>,
    endpoint: &CryptoEndpoint,
    mls_payload: &[u8],
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
            direct_payloads: Vec::new(),
            mls_application_payload: mls_payload.to_vec(),
            mls_application_payload_sha256: Sha256::digest(mls_payload).to_vec(),
        })),
    }
}

fn timestamp(unix_ms: i64) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: unix_ms.div_euclid(1_000),
        nanos: (unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::private_content::{decode_message_private_content, test_attachment_metadata};
    use crate::mls::group::MlsMemberKeyPackage;
    use crate::proto::actor_device_ref;
    use crate::store::{MlsOutboundEditCommit, MlsOutboundSendCommit};
    use std::sync::Mutex;

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct PersistedSend {
        command_bytes: Vec<u8>,
        session_state: Vec<u8>,
        private_content: Vec<u8>,
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct PersistedEdit {
        command_bytes: Vec<u8>,
        session_state: Vec<u8>,
        edited_text: String,
    }

    struct TestOutboundRepository {
        authority_head: (i64, Vec<u8>),
        fail_persistence: Mutex<bool>,
        send_attempts: Mutex<Vec<Vec<u8>>>,
        send: Mutex<Option<PersistedSend>>,
        edit: Mutex<Option<PersistedEdit>>,
    }

    impl TestOutboundRepository {
        fn new() -> Self {
            Self {
                authority_head: (0, Vec::new()),
                fail_persistence: Mutex::new(false),
                send_attempts: Mutex::new(Vec::new()),
                send: Mutex::new(None),
                edit: Mutex::new(None),
            }
        }

        fn set_fail_persistence(&self, fail: bool) {
            *self.fail_persistence.lock().unwrap() = fail;
        }
    }

    impl MlsOutboundRepository for TestOutboundRepository {
        fn validate_sender_attachments_ready(
            &self,
            _conversation_id: &str,
            _message_id: &str,
            _attachments: &[AttachmentPlaintextMetadata],
        ) -> Result<(), String> {
            Ok(())
        }

        fn authority_head(&self, _conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
            Ok(self.authority_head.clone())
        }

        fn persist_mls_outbound_send(
            &self,
            commit: &MlsOutboundSendCommit<'_>,
        ) -> Result<(), String> {
            self.send_attempts
                .lock()
                .unwrap()
                .push(commit.command_bytes.to_vec());
            if *self.fail_persistence.lock().unwrap() {
                return Err("persistence".to_string());
            }
            *self.send.lock().unwrap() = Some(PersistedSend {
                command_bytes: commit.command_bytes.to_vec(),
                session_state: commit.session_state.to_vec(),
                private_content: commit.projection.private_content.to_vec(),
            });
            Ok(())
        }

        fn persist_mls_outbound_edit(
            &self,
            commit: &MlsOutboundEditCommit<'_>,
        ) -> Result<(), String> {
            if *self.fail_persistence.lock().unwrap() {
                return Err("persistence".to_string());
            }
            *self.edit.lock().unwrap() = Some(PersistedEdit {
                command_bytes: commit.command_bytes.to_vec(),
                session_state: commit.session_state.to_vec(),
                edited_text: commit.edited_text.to_string(),
            });
            Ok(())
        }
    }

    fn group() -> (Arc<MlsGroupManager>, MlsGroupManager) {
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
        (alice, bob)
    }

    fn plan() -> PrepareConversationCommandResponse {
        PrepareConversationCommandResponse {
            conversation_id: "group-1".to_string(),
            conversation_kind: ConversationKind::Group as i32,
            authority_sequence: 0,
            authority_hash: Vec::new(),
            membership_epoch: 1,
            mls_epoch: 1,
            required_endpoints: vec![
                actor_device_ref("ptid:alice", "alice-device"),
                actor_device_ref("ptid:bob", "bob-device"),
            ],
            delivery_plan_sha256: vec![8; 32],
            endpoint_manifests: Vec::new(),
            authority_station_peer_id: "station-local".to_string(),
        }
    }

    fn preparer(
        store: Arc<TestOutboundRepository>,
        manager: Arc<MlsGroupManager>,
    ) -> MlsOutboundPreparer<TestOutboundRepository> {
        MlsOutboundPreparer::new(
            store,
            manager,
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
        )
        .unwrap()
    }

    #[test]
    fn group_edit_atomically_advances_mls_and_persists_exact_interaction() {
        let store = Arc::new(TestOutboundRepository::new());
        let (alice, bob) = group();
        let command = preparer(store.clone(), alice)
            .prepare_edit(
                &plan(),
                &GroupEditTextIntent {
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
        let persisted = store.edit.lock().unwrap().clone().unwrap();
        assert_eq!(persisted.command_bytes, command.encode_to_vec());
        assert!(!persisted.session_state.is_empty());
        assert_eq!(persisted.edited_text, "group edited plaintext");
    }

    #[test]
    fn group_prepare_persists_attachment_only_private_content_and_public_descriptor() {
        let store = Arc::new(TestOutboundRepository::new());
        let (alice, bob) = group();
        let attachment = test_attachment_metadata("group-attachment-1");
        let command = preparer(store.clone(), alice)
            .prepare_send(
                &plan(),
                &GroupSendTextIntent {
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
        let persisted = store.send.lock().unwrap().clone().unwrap();
        assert_eq!(persisted.command_bytes, command.encode_to_vec());
        assert!(!persisted.session_state.is_empty());
        assert_eq!(
            decode_message_private_content(&persisted.private_content)
                .unwrap()
                .attachments,
            private_content.attachments
        );
    }

    #[test]
    fn group_forward_reencrypts_plaintext_and_attachment_for_destination() {
        let store = Arc::new(TestOutboundRepository::new());
        let (alice, bob) = group();
        let attachment = test_attachment_metadata("forwarded-group-attachment");
        let command = preparer(store.clone(), alice)
            .prepare_forward(
                &plan(),
                &GroupForwardIntent {
                    command_id: "forward-command-1",
                    destination_message_id: "destination-message-1",
                    conversation_id: "group-1",
                    plaintext: "fresh destination plaintext",
                    attachments: std::slice::from_ref(&attachment),
                    client_timestamp_unix_ms: 100,
                },
            )
            .unwrap();

        let forward = match command.payload.as_ref().unwrap() {
            chat_command::Payload::ForwardMessage(forward) => forward,
            _ => panic!("unexpected command payload"),
        };
        assert_eq!(forward.destination_message_id, "destination-message-1");
        assert_eq!(
            forward.destination_attachments,
            vec![attachment.object.clone().unwrap()]
        );
        assert_eq!(
            Sha256::digest(&forward.mls_application_payload).as_slice(),
            forward.mls_application_payload_sha256,
        );
        let decrypted = bob
            .decrypt("group-1", &forward.mls_application_payload)
            .unwrap();
        let private_content = decode_message_private_content(&decrypted).unwrap();
        assert_eq!(private_content.text, "fresh destination plaintext");
        assert_eq!(private_content.attachments, vec![attachment]);
        assert_eq!(
            store.send.lock().unwrap().as_ref().unwrap().command_bytes,
            command.encode_to_vec(),
        );
    }

    #[test]
    fn persistence_failure_does_not_install_prepared_outbound_state() {
        let store = Arc::new(TestOutboundRepository::new());
        store.set_fail_persistence(true);
        let (alice, bob) = group();
        let preparer = preparer(store.clone(), alice);
        let intent = GroupSendTextIntent {
            command_id: "group-command-1",
            message_id: "group-message-1",
            conversation_id: "group-1",
            plaintext: "durable before live",
            reply_to_message_id: "",
            thread_root_message_id: "",
            attachments: &[],
            client_timestamp_unix_ms: 100,
        };

        assert_eq!(
            preparer.prepare_send(&plan(), &intent).unwrap_err(),
            "persistence"
        );
        let failed_command =
            ChatCommand::decode(store.send_attempts.lock().unwrap()[0].as_slice()).unwrap();
        let failed_payload = match failed_command.payload.as_ref().unwrap() {
            chat_command::Payload::SendMessage(send) => send.mls_application_payload.clone(),
            _ => panic!("unexpected command payload"),
        };
        store.set_fail_persistence(false);
        let command = preparer.prepare_send(&plan(), &intent).unwrap();
        let send = match command.payload.as_ref().unwrap() {
            chat_command::Payload::SendMessage(send) => send,
            _ => panic!("unexpected command payload"),
        };
        let received = bob
            .prepare_application_message("group-1", &send.mls_application_payload)
            .unwrap();
        bob.install_prepared_application("group-1", &received)
            .unwrap();
        assert_eq!(
            decode_message_private_content(&received.plaintext)
                .unwrap()
                .text,
            "durable before live"
        );
        assert!(bob
            .prepare_application_message("group-1", &failed_payload)
            .is_err());
    }
}
