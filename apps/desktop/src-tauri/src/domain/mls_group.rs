use openmls::key_packages::KeyPackageIn;
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use tls_codec::{Deserialize as TlsDeserializeTrait, Serialize as TlsSerializeTrait};

use super::actor_device_identity::{
    decode_device_credential, encode_device_credential, ActorDeviceIdentity,
    MLS_DEVICE_CREDENTIAL_VERSION,
};
use super::mls::{create_key_package, PeersMLSProvider, PEERS_CIPHERSUITE};
use crate::model::chat::{
    MembershipTransitionAction, MembershipTransitionChange, MlsDeviceCredential,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct MlsGroupCreateResult {
    pub group_id: String,
    pub transition_id: String,
    pub from_mls_epoch: u64,
    pub to_mls_epoch: u64,
    pub welcome_bytes: Vec<u8>,
    pub commit_bytes: Vec<u8>,
    pub commit_sha256: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MlsGroupEncryptResult {
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MlsPublicHead {
    pub conversation_id: String,
    pub mls_epoch: u64,
    pub group_context_sha256: String,
    pub ratchet_tree_sha256: String,
    pub member_credentials_sha256: String,
    pub members: Vec<MlsPublicMember>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MlsPublicMember {
    pub ptid: String,
    pub device_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MlsMemberKeyPackage {
    pub ptid: String,
    pub device_id: String,
    pub key_package: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MlsPreparedTransition {
    pub transition_id: String,
    pub from_mls_epoch: u64,
    pub to_mls_epoch: u64,
    pub commit_bytes: Vec<u8>,
    pub commit_sha256: Vec<u8>,
    pub welcome_bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct MlsPreparedReceive {
    pub session_state: Vec<u8>,
    pub provider_pool_state: Option<Vec<u8>>,
}

pub struct MlsGroupSession {
    provider: PeersMLSProvider,
    signer: SignatureKeyPair,
    group: MlsGroup,
}

#[derive(Serialize, Deserialize)]
struct PersistedMlsGroupSession {
    provider_state: Vec<u8>,
    signer: SignatureKeyPair,
}

struct PendingMlsTransition {
    result: MlsPreparedTransition,
    session: MlsGroupSession,
}

#[derive(Serialize, Deserialize)]
struct PersistedPendingMlsTransition {
    result: MlsPreparedTransition,
    session_state: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct PersistedMlsJoinProviderPool {
    provider_states: Vec<Vec<u8>>,
}

pub struct MlsGroupManager {
    sessions: Mutex<HashMap<String, MlsGroupSession>>,
    pending_transitions: Mutex<HashMap<String, PendingMlsTransition>>,
    actor_identity: Arc<ActorDeviceIdentity>,
    pending_join_providers: Mutex<Vec<PeersMLSProvider>>,
    recipient_transition_lock: Mutex<()>,
}

fn validate_member_key_package(
    provider: &PeersMLSProvider,
    member: &MlsMemberKeyPackage,
) -> Result<KeyPackage, String> {
    let expected = encode_device_credential(&member.ptid, &member.device_id)?;
    let kp_in = KeyPackageIn::tls_deserialize(&mut Cursor::new(&member.key_package))
        .map_err(|e| format!("deserialize kp: {e:?}"))?;
    let kp = kp_in
        .validate(provider.crypto(), ProtocolVersion::Mls10)
        .map_err(|e| format!("validate kp: {e:?}"))?;
    if kp.leaf_node().credential().serialized_content() != expected {
        return Err(
            "KeyPackage credential does not match PTID/device routing metadata".to_string(),
        );
    }
    Ok(kp)
}

impl MlsGroupManager {
    pub fn new() -> Self {
        Self::with_actor_identity(Arc::new(ActorDeviceIdentity::new()))
    }

    pub fn with_actor_identity(actor_identity: Arc<ActorDeviceIdentity>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            pending_transitions: Mutex::new(HashMap::new()),
            actor_identity,
            pending_join_providers: Mutex::new(Vec::new()),
            recipient_transition_lock: Mutex::new(()),
        }
    }

    pub fn actor_identity(&self) -> Arc<ActorDeviceIdentity> {
        self.actor_identity.clone()
    }

    pub fn lock_recipient_transitions(&self) -> std::sync::MutexGuard<'_, ()> {
        self.recipient_transition_lock.lock().unwrap()
    }

    pub fn has_session(&self, conversation_id: &str) -> bool {
        self.sessions.lock().unwrap().contains_key(conversation_id)
    }

    pub fn remove_session(&self, conversation_id: &str) -> bool {
        self.sessions
            .lock()
            .unwrap()
            .remove(conversation_id)
            .is_some()
    }

    pub fn generate_key_package(&self) -> Result<Vec<u8>, String> {
        let (signer, cwk) = self.actor_identity.snapshot()?;
        let provider = PeersMLSProvider::new();
        let kp = create_key_package(&provider, &signer, cwk)?;
        let kp_bytes = kp
            .tls_serialize_detached()
            .map_err(|e| format!("serialize key package: {e:?}"))?;
        self.pending_join_providers.lock().unwrap().push(provider);
        Ok(kp_bytes)
    }

    pub fn export_pending_join_providers(&self) -> Result<Vec<u8>, String> {
        let providers = self.pending_join_providers.lock().unwrap();
        serialize_join_provider_pool(&providers)
    }

    pub fn import_pending_join_providers(&self, state_bytes: &[u8]) -> Result<usize, String> {
        let restored = restore_join_provider_pool(state_bytes)?;
        let count = restored.len();
        *self.pending_join_providers.lock().unwrap() = restored;
        Ok(count)
    }

    pub fn create_group(
        &self,
        conversation_id: &str,
        members: &[MlsMemberKeyPackage],
    ) -> Result<MlsGroupCreateResult, String> {
        let (signer, cwk) = self.actor_identity.snapshot()?;
        let own_credential = decode_device_credential(cwk.credential.serialized_content())?;
        let mut leaf_identities = HashSet::from([(own_credential.ptid, own_credential.device_id)]);
        for member in members {
            if !leaf_identities.insert((member.ptid.clone(), member.device_id.clone())) {
                return Err("duplicate MLS actor-device leaf identity".to_string());
            }
        }

        let provider = PeersMLSProvider::new();
        let group_id = GroupId::from_slice(conversation_id.as_bytes());

        let mut group = MlsGroup::builder()
            .ciphersuite(PEERS_CIPHERSUITE)
            .with_group_id(group_id)
            .use_ratchet_tree_extension(true)
            .build(&provider, &signer, cwk)
            .map_err(|e| format!("create group: {e:?}"))?;

        let mut welcome_bytes = Vec::new();
        let mut commit_bytes = Vec::new();

        if !members.is_empty() {
            let kps: Result<Vec<KeyPackage>, _> = members
                .iter()
                .map(|member| validate_member_key_package(&provider, member))
                .collect();
            let kps = kps?;

            let (mls_out, welcome, _group_info) = group
                .add_members(&provider, &signer, kps.as_slice())
                .map_err(|e| format!("add members: {e:?}"))?;

            commit_bytes = mls_out
                .tls_serialize_detached()
                .map_err(|e| format!("serialize commit: {e:?}"))?;
            welcome_bytes = welcome
                .tls_serialize_detached()
                .map_err(|e| format!("serialize welcome: {e:?}"))?;
        }

        if commit_bytes.is_empty() {
            return Err("MLS group genesis requires at least one invited member".to_string());
        }
        let session = MlsGroupSession {
            provider,
            signer,
            group,
        };
        let prepared = prepared_transition(0, commit_bytes, welcome_bytes);
        self.pending_transitions.lock().unwrap().insert(
            conversation_id.to_string(),
            PendingMlsTransition {
                result: prepared.clone(),
                session,
            },
        );

        Ok(MlsGroupCreateResult {
            group_id: conversation_id.to_string(),
            transition_id: prepared.transition_id,
            from_mls_epoch: prepared.from_mls_epoch,
            to_mls_epoch: prepared.to_mls_epoch,
            welcome_bytes: prepared.welcome_bytes,
            commit_bytes: prepared.commit_bytes,
            commit_sha256: prepared.commit_sha256,
        })
    }

    pub fn join_group(&self, conversation_id: &str, welcome_bytes: &[u8]) -> Result<(), String> {
        let (signer, _cwk) = self.actor_identity.snapshot()?;

        let mls_group_config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .build();
        let mut pending = self.pending_join_providers.lock().unwrap();
        let mut matched = None;
        for index in 0..pending.len() {
            let provider = &pending[index];
            let welcome = MlsMessageIn::tls_deserialize(&mut Cursor::new(welcome_bytes))
                .map_err(|e| format!("deserialize welcome: {e:?}"))?
                .into_welcome()
                .ok_or("message is not a Welcome")?;
            let Ok(staged) =
                StagedWelcome::new_from_welcome(provider, &mls_group_config, welcome, None)
            else {
                continue;
            };
            let group = staged
                .into_group(provider)
                .map_err(|e| format!("join group: {e:?}"))?;
            if group.group_id().as_slice() != conversation_id.as_bytes() {
                return Err("Welcome group id does not match conversation".to_string());
            }
            validate_group_device_credentials(&group)?;
            matched = Some((index, group));
            break;
        }
        let Some((provider_index, group)) = matched else {
            return Err("stage welcome: NoMatchingKeyPackage".to_string());
        };
        let provider = pending.remove(provider_index);
        drop(pending);

        let session = MlsGroupSession {
            provider,
            signer,
            group,
        };

        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(conversation_id.to_string(), session);
        Ok(())
    }

    pub fn encrypt(
        &self,
        conversation_id: &str,
        plaintext: &[u8],
    ) -> Result<MlsGroupEncryptResult, String> {
        if self
            .pending_transitions
            .lock()
            .unwrap()
            .contains_key(conversation_id)
        {
            return Err("MLS membership transition is awaiting authority acceptance".to_string());
        }
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(conversation_id)
            .ok_or("no MLS session for this conversation")?;

        let mls_out = session
            .group
            .create_message(&session.provider, &session.signer, plaintext)
            .map_err(|e| format!("encrypt: {e:?}"))?;

        let ciphertext = mls_out
            .tls_serialize_detached()
            .map_err(|e| format!("serialize message: {e:?}"))?;

        Ok(MlsGroupEncryptResult { ciphertext })
    }

    pub fn decrypt(&self, conversation_id: &str, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(conversation_id)
            .ok_or("no MLS session for this conversation")?;

        let mls_msg = MlsMessageIn::tls_deserialize(&mut Cursor::new(ciphertext))
            .map_err(|e| format!("deserialize message: {e:?}"))?;

        let protocol_msg = mls_msg
            .into_protocol_message()
            .ok_or("not a protocol message")?;

        let protocol_msg = session
            .group
            .process_message(&session.provider, protocol_msg)
            .map_err(|e| format!("process message: {e:?}"))?;

        match protocol_msg.into_content() {
            ProcessedMessageContent::ApplicationMessage(app_msg) => Ok(app_msg.into_bytes()),
            ProcessedMessageContent::StagedCommitMessage(_) => {
                Err("unexpected commit message in decrypt path".to_string())
            }
            ProcessedMessageContent::ProposalMessage(_) => {
                Err("unexpected proposal in decrypt path".to_string())
            }
            _ => Err("unknown message content type".to_string()),
        }
    }

    pub fn process_commit(&self, conversation_id: &str, commit_bytes: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(conversation_id)
            .ok_or("no MLS session for this conversation")?;
        let mut prepared = restore_session(conversation_id, &serialize_session(session)?)?;
        process_commit_on_session(&mut prepared, commit_bytes)?;
        sessions.insert(conversation_id.to_string(), prepared);
        Ok(())
    }

    pub fn prepare_received_commit(
        &self,
        conversation_id: &str,
        commit_bytes: &[u8],
        changes: &[MembershipTransitionChange],
    ) -> Result<MlsPreparedReceive, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(conversation_id)
            .ok_or("no MLS session for this conversation")?;
        let mut prepared = restore_session(conversation_id, &serialize_session(session)?)?;
        let before = group_leaf_identities(&prepared.group)?;
        drop(sessions);
        process_commit_on_session(&mut prepared, commit_bytes)?;
        let after = group_leaf_identities(&prepared.group)?;
        validate_commit_leaf_changes(&before, &after, changes)?;
        Ok(MlsPreparedReceive {
            session_state: serialize_session(&prepared)?,
            provider_pool_state: None,
        })
    }

    pub fn prepare_received_welcome(
        &self,
        conversation_id: &str,
        welcome_bytes: &[u8],
        changes: &[MembershipTransitionChange],
    ) -> Result<MlsPreparedReceive, String> {
        let (signer, _cwk) = self.actor_identity.snapshot()?;
        let providers = self.pending_join_providers.lock().unwrap();
        let provider_pool_state = serialize_join_provider_pool(&providers)?;
        drop(providers);
        let mut providers = restore_join_provider_pool(&provider_pool_state)?;
        let config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .build();
        let mut matched = None;
        for (index, provider) in providers.iter().enumerate() {
            let welcome = MlsMessageIn::tls_deserialize(&mut Cursor::new(welcome_bytes))
                .map_err(|e| format!("deserialize welcome: {e:?}"))?
                .into_welcome()
                .ok_or("message is not a Welcome")?;
            let Ok(staged) = StagedWelcome::new_from_welcome(provider, &config, welcome, None)
            else {
                continue;
            };
            let group = staged
                .into_group(provider)
                .map_err(|e| format!("join group: {e:?}"))?;
            if group.group_id().as_slice() != conversation_id.as_bytes() {
                return Err("Welcome group id does not match conversation".to_string());
            }
            matched = Some((index, group));
            break;
        }
        let Some((provider_index, group)) = matched else {
            return Err("stage welcome: NoMatchingKeyPackage".to_string());
        };
        validate_welcome_leaf_changes(&group_leaf_identities(&group)?, changes)?;
        let provider = providers.remove(provider_index);
        let session = MlsGroupSession {
            provider,
            signer,
            group,
        };
        Ok(MlsPreparedReceive {
            session_state: serialize_session(&session)?,
            provider_pool_state: Some(serialize_join_provider_pool(&providers)?),
        })
    }

    pub fn install_received_state(
        &self,
        conversation_id: &str,
        prepared: &MlsPreparedReceive,
    ) -> Result<(), String> {
        self.import_session_state(conversation_id, &prepared.session_state)?;
        if let Some(provider_pool_state) = prepared.provider_pool_state.as_deref() {
            self.import_pending_join_providers(provider_pool_state)?;
        }
        Ok(())
    }

    pub fn add_member(
        &self,
        conversation_id: &str,
        member: &MlsMemberKeyPackage,
    ) -> Result<MlsPreparedTransition, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(conversation_id)
            .ok_or("no MLS session for this conversation")?;
        let mut prepared = restore_session(conversation_id, &serialize_session(session)?)?;
        drop(sessions);

        let kp = validate_member_key_package(&prepared.provider, member)?;

        let (mls_out, welcome, _group_info) = prepared
            .group
            .add_members(&prepared.provider, &prepared.signer, &[kp])
            .map_err(|e| format!("add member: {e:?}"))?;

        let commit_bytes = mls_out
            .tls_serialize_detached()
            .map_err(|e| format!("serialize commit: {e:?}"))?;
        let welcome_bytes = welcome
            .tls_serialize_detached()
            .map_err(|e| format!("serialize welcome: {e:?}"))?;

        let result =
            prepared_transition(prepared.group.epoch().as_u64(), commit_bytes, welcome_bytes);
        self.pending_transitions.lock().unwrap().insert(
            conversation_id.to_string(),
            PendingMlsTransition {
                result: result.clone(),
                session: prepared,
            },
        );
        Ok(result)
    }

    pub fn remove_member(
        &self,
        conversation_id: &str,
        member_ptid: &str,
    ) -> Result<MlsPreparedTransition, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(conversation_id)
            .ok_or("no MLS session for this conversation")?;
        let mut prepared = restore_session(conversation_id, &serialize_session(session)?)?;
        drop(sessions);

        let leaf_indices = prepared
            .group
            .members()
            .map(|member| {
                let credential = decode_device_credential(member.credential.serialized_content())?;
                Ok((credential.ptid == member_ptid).then_some(member.index))
            })
            .collect::<Result<Vec<_>, String>>()?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        if leaf_indices.is_empty() {
            return Err("member is not present in the MLS group".to_string());
        }
        let (mls_out, _welcome, _group_info) = prepared
            .group
            .remove_members(&prepared.provider, &prepared.signer, &leaf_indices)
            .map_err(|e| format!("remove member: {e:?}"))?;

        let commit_bytes = mls_out
            .tls_serialize_detached()
            .map_err(|e| format!("serialize commit: {e:?}"))?;

        let result = prepared_transition(prepared.group.epoch().as_u64(), commit_bytes, Vec::new());
        self.pending_transitions.lock().unwrap().insert(
            conversation_id.to_string(),
            PendingMlsTransition {
                result: result.clone(),
                session: prepared,
            },
        );
        Ok(result)
    }

    pub fn remove_device(
        &self,
        conversation_id: &str,
        member_ptid: &str,
        device_id: &str,
    ) -> Result<MlsPreparedTransition, String> {
        let expected = encode_device_credential(member_ptid, device_id)?;
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(conversation_id)
            .ok_or("no MLS session for this conversation")?;
        let mut prepared = restore_session(conversation_id, &serialize_session(session)?)?;
        drop(sessions);

        let leaf_index = prepared
            .group
            .members()
            .map(|member| {
                decode_device_credential(member.credential.serialized_content())?;
                Ok((member.credential.serialized_content() == expected).then_some(member.index))
            })
            .collect::<Result<Vec<_>, String>>()?
            .into_iter()
            .flatten()
            .next()
            .ok_or("device is not present in the MLS group")?;
        let (mls_out, _welcome, _group_info) = prepared
            .group
            .remove_members(&prepared.provider, &prepared.signer, &[leaf_index])
            .map_err(|e| format!("remove device: {e:?}"))?;
        let commit_bytes = mls_out
            .tls_serialize_detached()
            .map_err(|e| format!("serialize commit: {e:?}"))?;
        let result = prepared_transition(prepared.group.epoch().as_u64(), commit_bytes, Vec::new());
        self.pending_transitions.lock().unwrap().insert(
            conversation_id.to_string(),
            PendingMlsTransition {
                result: result.clone(),
                session: prepared,
            },
        );
        Ok(result)
    }

    pub fn accept_pending_transition(
        &self,
        conversation_id: &str,
        expected_transition_id: &str,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let mut pending = self.pending_transitions.lock().unwrap();
        let prepared = pending
            .get_mut(conversation_id)
            .ok_or("no pending MLS membership transition")?;
        if prepared.result.transition_id != expected_transition_id {
            return Err("authority accepted a different MLS transition".to_string());
        }
        prepared
            .session
            .group
            .merge_pending_commit(&prepared.session.provider)
            .map_err(|e| format!("merge accepted commit: {e:?}"))?;
        validate_group_device_credentials(&prepared.session.group)?;
        let accepted = pending
            .remove(conversation_id)
            .ok_or("pending MLS membership transition disappeared")?;
        sessions.insert(conversation_id.to_string(), accepted.session);
        Ok(())
    }

    pub fn discard_pending_transition(&self, conversation_id: &str) -> bool {
        self.pending_transitions
            .lock()
            .unwrap()
            .remove(conversation_id)
            .is_some()
    }

    pub fn has_pending_transition(&self, conversation_id: &str) -> bool {
        self.pending_transitions
            .lock()
            .unwrap()
            .contains_key(conversation_id)
    }

    pub fn pending_transition(
        &self,
        conversation_id: &str,
    ) -> Result<MlsPreparedTransition, String> {
        self.pending_transitions
            .lock()
            .unwrap()
            .get(conversation_id)
            .map(|pending| pending.result.clone())
            .ok_or_else(|| "no pending MLS membership transition".to_string())
    }

    pub fn group_epoch(&self, conversation_id: &str) -> Result<u64, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(conversation_id)
            .ok_or("no MLS session for this conversation")?;
        Ok(session.group.epoch().as_u64())
    }

    pub fn public_head(&self, conversation_id: &str) -> Result<MlsPublicHead, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(conversation_id)
            .ok_or("no MLS session for this conversation")?;
        let group_context = session
            .group
            .export_group_context()
            .tls_serialize_detached()
            .map_err(|e| format!("serialize public group context: {e:?}"))?;
        let ratchet_tree = session
            .group
            .export_ratchet_tree()
            .tls_serialize_detached()
            .map_err(|e| format!("serialize public ratchet tree: {e:?}"))?;
        let mut credentials = session
            .group
            .members()
            .map(|member| decode_device_credential(member.credential.serialized_content()))
            .collect::<Result<Vec<_>, _>>()?;
        credentials.sort_by(|left, right| {
            (&left.ptid, &left.device_id).cmp(&(&right.ptid, &right.device_id))
        });
        let mut credential_bytes = Vec::new();
        for member in &credentials {
            let encoded = member.encode_to_vec();
            credential_bytes.extend_from_slice(&(encoded.len() as u32).to_be_bytes());
            credential_bytes.extend_from_slice(&encoded);
        }
        let members = credentials
            .into_iter()
            .map(|credential| MlsPublicMember {
                ptid: credential.ptid,
                device_id: credential.device_id,
            })
            .collect();
        Ok(MlsPublicHead {
            conversation_id: conversation_id.to_string(),
            mls_epoch: session.group.epoch().as_u64(),
            group_context_sha256: hex::encode(Sha256::digest(group_context)),
            ratchet_tree_sha256: hex::encode(Sha256::digest(ratchet_tree)),
            member_credentials_sha256: hex::encode(Sha256::digest(credential_bytes)),
            members,
        })
    }

    pub fn export_pending_transition(&self, conversation_id: &str) -> Result<Vec<u8>, String> {
        let pending = self.pending_transitions.lock().unwrap();
        let transition = pending
            .get(conversation_id)
            .ok_or("no pending MLS membership transition")?;
        serde_json::to_vec(&PersistedPendingMlsTransition {
            result: transition.result.clone(),
            session_state: serialize_session(&transition.session)?,
        })
        .map_err(|e| format!("serialize pending MLS transition: {e}"))
    }

    pub fn import_pending_transition(
        &self,
        conversation_id: &str,
        state_bytes: &[u8],
    ) -> Result<MlsPreparedTransition, String> {
        let persisted: PersistedPendingMlsTransition = serde_json::from_slice(state_bytes)
            .map_err(|e| format!("deserialize pending MLS transition: {e}"))?;
        let session = restore_session(conversation_id, &persisted.session_state)?;
        let result = persisted.result.clone();
        self.pending_transitions.lock().unwrap().insert(
            conversation_id.to_string(),
            PendingMlsTransition {
                result: persisted.result,
                session,
            },
        );
        Ok(result)
    }

    pub fn export_session_state(&self, conversation_id: &str) -> Result<Vec<u8>, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(conversation_id)
            .ok_or("no MLS session for this conversation")?;
        serialize_session(session)
    }

    pub fn import_session_state(
        &self,
        conversation_id: &str,
        state_bytes: &[u8],
    ) -> Result<(), String> {
        let session = restore_session(conversation_id, state_bytes)?;

        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(conversation_id.to_string(), session);
        Ok(())
    }
}

fn serialize_session(session: &MlsGroupSession) -> Result<Vec<u8>, String> {
    let persisted = PersistedMlsGroupSession {
        provider_state: session.provider.export_state()?,
        signer: session.signer.clone(),
    };
    serde_json::to_vec(&persisted).map_err(|e| format!("serialize MLS session: {e}"))
}

fn serialize_join_provider_pool(providers: &[PeersMLSProvider]) -> Result<Vec<u8>, String> {
    let provider_states = providers
        .iter()
        .map(PeersMLSProvider::export_state)
        .collect::<Result<Vec<_>, _>>()?;
    serde_json::to_vec(&PersistedMlsJoinProviderPool { provider_states })
        .map_err(|e| format!("serialize MLS join provider pool: {e}"))
}

fn restore_join_provider_pool(state_bytes: &[u8]) -> Result<Vec<PeersMLSProvider>, String> {
    let persisted: PersistedMlsJoinProviderPool = serde_json::from_slice(state_bytes)
        .map_err(|e| format!("deserialize MLS join provider pool: {e}"))?;
    let mut restored = Vec::with_capacity(persisted.provider_states.len());
    for state in persisted.provider_states {
        let mut provider = PeersMLSProvider::new();
        provider.import_state(&state)?;
        restored.push(provider);
    }
    Ok(restored)
}

fn process_commit_on_session(
    session: &mut MlsGroupSession,
    commit_bytes: &[u8],
) -> Result<(), String> {
    let mls_msg = MlsMessageIn::tls_deserialize(&mut Cursor::new(commit_bytes))
        .map_err(|e| format!("deserialize commit: {e:?}"))?;
    let protocol_msg = mls_msg
        .into_protocol_message()
        .ok_or("commit is not a protocol message")?;
    let processed = session
        .group
        .process_message(&session.provider, protocol_msg)
        .map_err(|e| format!("process commit: {e:?}"))?;
    match processed.into_content() {
        ProcessedMessageContent::StagedCommitMessage(staged) => {
            session
                .group
                .merge_staged_commit(&session.provider, *staged)
                .map_err(|e| format!("merge staged commit: {e:?}"))?;
            validate_group_device_credentials(&session.group)
        }
        _ => Err("expected commit message".to_string()),
    }
}

fn validate_group_device_credentials(group: &MlsGroup) -> Result<(), String> {
    group_leaf_identities(group).map(|_| ())
}

fn group_leaf_identities(group: &MlsGroup) -> Result<HashSet<(String, String)>, String> {
    let mut identities = HashSet::new();
    for member in group.members() {
        let credential = decode_device_credential(member.credential.serialized_content())?;
        if !identities.insert((credential.ptid, credential.device_id)) {
            return Err("MLS group contains a duplicate actor-device leaf identity".to_string());
        }
    }
    Ok(identities)
}

fn validate_commit_leaf_changes(
    before: &HashSet<(String, String)>,
    after: &HashSet<(String, String)>,
    changes: &[MembershipTransitionChange],
) -> Result<(), String> {
    let mut expected = before.clone();
    for change in changes {
        let action = MembershipTransitionAction::try_from(change.action)
            .map_err(|_| "authority event contains an unknown membership action".to_string())?;
        match action {
            MembershipTransitionAction::Add | MembershipTransitionAction::AddDevice => {
                if !expected.insert((change.ptid.clone(), change.device_id.clone())) {
                    return Err("authority event adds a duplicate MLS leaf".to_string());
                }
            }
            MembershipTransitionAction::RemoveDevice => {
                if !expected.remove(&(change.ptid.clone(), change.device_id.clone())) {
                    return Err("authority event removes an unknown MLS device leaf".to_string());
                }
            }
            MembershipTransitionAction::Remove | MembershipTransitionAction::Leave => {
                expected.retain(|(ptid, _)| ptid != &change.ptid);
            }
            MembershipTransitionAction::RoleChange => {}
            MembershipTransitionAction::Unspecified => {
                return Err("authority event contains an unspecified membership action".to_string())
            }
        }
    }
    if &expected != after {
        return Err("OpenMLS Commit leaf changes do not match authority descriptors".to_string());
    }
    Ok(())
}

fn validate_welcome_leaf_changes(
    leaves: &HashSet<(String, String)>,
    changes: &[MembershipTransitionChange],
) -> Result<(), String> {
    for change in changes {
        let action = MembershipTransitionAction::try_from(change.action)
            .map_err(|_| "authority event contains an unknown membership action".to_string())?;
        match action {
            MembershipTransitionAction::Add | MembershipTransitionAction::AddDevice => {
                if !leaves.contains(&(change.ptid.clone(), change.device_id.clone())) {
                    return Err(
                        "OpenMLS Welcome is missing an authority-declared device leaf".to_string(),
                    );
                }
            }
            MembershipTransitionAction::RemoveDevice => {
                if leaves.contains(&(change.ptid.clone(), change.device_id.clone())) {
                    return Err(
                        "OpenMLS Welcome retains an authority-removed device leaf".to_string()
                    );
                }
            }
            MembershipTransitionAction::Remove | MembershipTransitionAction::Leave => {
                if leaves.iter().any(|(ptid, _)| ptid == &change.ptid) {
                    return Err("OpenMLS Welcome retains an authority-removed actor".to_string());
                }
            }
            MembershipTransitionAction::RoleChange => {}
            MembershipTransitionAction::Unspecified => {
                return Err("authority event contains an unspecified membership action".to_string())
            }
        }
    }
    Ok(())
}

fn prepared_transition(
    from_mls_epoch: u64,
    commit_bytes: Vec<u8>,
    welcome_bytes: Vec<u8>,
) -> MlsPreparedTransition {
    let commit_sha256 = Sha256::digest(&commit_bytes).to_vec();
    MlsPreparedTransition {
        transition_id: ulid::Ulid::new().to_string(),
        from_mls_epoch,
        to_mls_epoch: from_mls_epoch + 1,
        commit_bytes,
        commit_sha256,
        welcome_bytes,
    }
}

fn restore_session(conversation_id: &str, state_bytes: &[u8]) -> Result<MlsGroupSession, String> {
    let persisted: PersistedMlsGroupSession =
        serde_json::from_slice(state_bytes).map_err(|e| format!("deserialize MLS session: {e}"))?;
    let mut provider = PeersMLSProvider::new();
    provider.import_state(&persisted.provider_state)?;
    let group_id = GroupId::from_slice(conversation_id.as_bytes());
    let group = MlsGroup::load(provider.storage(), &group_id)
        .map_err(|e| format!("load group: {e:?}"))?
        .ok_or("group not found in storage")?;
    validate_group_device_credentials(&group)?;
    Ok(MlsGroupSession {
        provider,
        signer: persisted.signer,
        group,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member_key_package(
        ptid: &str,
        device_id: &str,
        key_package: Vec<u8>,
    ) -> MlsMemberKeyPackage {
        MlsMemberKeyPackage {
            ptid: ptid.to_string(),
            device_id: device_id.to_string(),
            key_package,
        }
    }

    #[test]
    fn device_credential_rejects_legacy_malformed_and_unknown_version() {
        let canonical =
            encode_device_credential("ptid:test:alice", "alice-device").expect("encode");
        assert_eq!(
            decode_device_credential(&canonical).expect("decode"),
            MlsDeviceCredential {
                version: MLS_DEVICE_CREDENTIAL_VERSION,
                ptid: "ptid:test:alice".to_string(),
                device_id: "alice-device".to_string(),
            }
        );
        assert!(decode_device_credential(b"ptid:test:alice").is_err());
        assert!(decode_device_credential(&[]).is_err());
        assert!(decode_device_credential(
            &MlsDeviceCredential {
                version: MLS_DEVICE_CREDENTIAL_VERSION + 1,
                ptid: "ptid:test:alice".to_string(),
                device_id: "alice-device".to_string(),
            }
            .encode_to_vec(),
        )
        .is_err());
    }

    #[test]
    fn identity_restore_is_bound_to_actor_device() {
        let original = MlsGroupManager::new();
        original
            .actor_identity()
            .init("ptid:test:bob", "bob-device-1")
            .unwrap();
        let state = original
            .actor_identity()
            .export("ptid:test:bob", "bob-device-1")
            .unwrap();

        assert!(MlsGroupManager::new()
            .actor_identity()
            .import("ptid:test:bob", "bob-device-2", &state)
            .is_err());
        assert!(MlsGroupManager::new()
            .actor_identity()
            .import("ptid:test:alice", "bob-device-1", &state)
            .is_err());
    }

    #[test]
    fn key_package_metadata_mismatch_fails_closed() {
        let alice = MlsGroupManager::new();
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob.actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();
        let bob_kp = bob.generate_key_package().unwrap();

        let error = alice
            .create_group(
                "conv-key-package-mismatch",
                &[member_key_package("ptid:test:bob", "wrong-device", bob_kp)],
            )
            .expect_err("routing metadata mismatch must fail");
        assert!(error.contains("does not match"));
        assert!(!alice.has_pending_transition("conv-key-package-mismatch"));
    }

    #[test]
    fn duplicate_actor_device_leaf_identity_fails_closed() {
        let alice = MlsGroupManager::new();
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob.actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();
        let first = bob.generate_key_package().unwrap();
        let second = bob.generate_key_package().unwrap();
        let error = alice
            .create_group(
                "conv-duplicate-leaf",
                &[
                    member_key_package("ptid:test:bob", "bob-device", first),
                    member_key_package("ptid:test:bob", "bob-device", second),
                ],
            )
            .expect_err("duplicate actor-device leaf must fail");
        assert!(error.contains("duplicate"));
        assert!(!alice.has_pending_transition("conv-duplicate-leaf"));
    }

    #[test]
    fn remove_device_preserves_sibling_leaf() {
        let alice = MlsGroupManager::new();
        let bob_device_1 = MlsGroupManager::new();
        let bob_device_2 = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob_device_1
            .actor_identity()
            .init("ptid:test:bob", "bob-device-1")
            .unwrap();
        bob_device_2
            .actor_identity()
            .init("ptid:test:bob", "bob-device-2")
            .unwrap();
        let created = alice
            .create_group(
                "conv-remove-device",
                &[
                    member_key_package(
                        "ptid:test:bob",
                        "bob-device-1",
                        bob_device_1.generate_key_package().unwrap(),
                    ),
                    member_key_package(
                        "ptid:test:bob",
                        "bob-device-2",
                        bob_device_2.generate_key_package().unwrap(),
                    ),
                ],
            )
            .unwrap();
        accept_genesis(&alice, "conv-remove-device", &created);
        bob_device_1
            .join_group("conv-remove-device", &created.welcome_bytes)
            .unwrap();
        bob_device_2
            .join_group("conv-remove-device", &created.welcome_bytes)
            .unwrap();

        let removed = alice
            .remove_device("conv-remove-device", "ptid:test:bob", "bob-device-1")
            .unwrap();
        alice
            .accept_pending_transition("conv-remove-device", &removed.transition_id)
            .unwrap();
        bob_device_2
            .process_commit("conv-remove-device", &removed.commit_bytes)
            .unwrap();
        let alice_head = alice.public_head("conv-remove-device").unwrap();
        let bob_head = bob_device_2.public_head("conv-remove-device").unwrap();
        assert_eq!(alice_head.mls_epoch, bob_head.mls_epoch);
        assert_eq!(
            alice_head.group_context_sha256,
            bob_head.group_context_sha256
        );
        assert_eq!(alice_head.ratchet_tree_sha256, bob_head.ratchet_tree_sha256);
        assert_eq!(
            alice_head.member_credentials_sha256,
            bob_head.member_credentials_sha256
        );
        let ciphertext = alice
            .encrypt("conv-remove-device", b"sibling survives")
            .unwrap();
        assert_eq!(
            bob_device_2
                .decrypt("conv-remove-device", &ciphertext.ciphertext)
                .unwrap(),
            b"sibling survives"
        );
        assert!(bob_device_1
            .decrypt("conv-remove-device", &ciphertext.ciphertext)
            .is_err());
    }

    #[test]
    fn remove_actor_removes_every_device_leaf() {
        let alice = MlsGroupManager::new();
        let bob_device_1 = MlsGroupManager::new();
        let bob_device_2 = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob_device_1
            .actor_identity()
            .init("ptid:test:bob", "bob-device-1")
            .unwrap();
        bob_device_2
            .actor_identity()
            .init("ptid:test:bob", "bob-device-2")
            .unwrap();
        let created = alice
            .create_group(
                "conv-remove-actor",
                &[
                    member_key_package(
                        "ptid:test:bob",
                        "bob-device-1",
                        bob_device_1.generate_key_package().unwrap(),
                    ),
                    member_key_package(
                        "ptid:test:bob",
                        "bob-device-2",
                        bob_device_2.generate_key_package().unwrap(),
                    ),
                ],
            )
            .unwrap();
        accept_genesis(&alice, "conv-remove-actor", &created);
        bob_device_1
            .join_group("conv-remove-actor", &created.welcome_bytes)
            .unwrap();
        bob_device_2
            .join_group("conv-remove-actor", &created.welcome_bytes)
            .unwrap();

        let removed = alice
            .remove_member("conv-remove-actor", "ptid:test:bob")
            .unwrap();
        alice
            .accept_pending_transition("conv-remove-actor", &removed.transition_id)
            .unwrap();
        let ciphertext = alice
            .encrypt("conv-remove-actor", b"actor removed")
            .unwrap();
        assert!(bob_device_1
            .decrypt("conv-remove-actor", &ciphertext.ciphertext)
            .is_err());
        assert!(bob_device_2
            .decrypt("conv-remove-actor", &ciphertext.ciphertext)
            .is_err());
    }

    #[test]
    fn member_cannot_author_own_leave_commit() {
        let alice = MlsGroupManager::new();
        let bob_device_1 = MlsGroupManager::new();
        let bob_device_2 = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob_device_1
            .actor_identity()
            .init("ptid:test:bob", "bob-device-1")
            .unwrap();
        bob_device_2
            .actor_identity()
            .init("ptid:test:bob", "bob-device-2")
            .unwrap();
        let created = alice
            .create_group(
                "conv-self-leave",
                &[
                    member_key_package(
                        "ptid:test:bob",
                        "bob-device-1",
                        bob_device_1.generate_key_package().unwrap(),
                    ),
                    member_key_package(
                        "ptid:test:bob",
                        "bob-device-2",
                        bob_device_2.generate_key_package().unwrap(),
                    ),
                ],
            )
            .unwrap();
        accept_genesis(&alice, "conv-self-leave", &created);
        bob_device_1
            .join_group("conv-self-leave", &created.welcome_bytes)
            .unwrap();
        bob_device_2
            .join_group("conv-self-leave", &created.welcome_bytes)
            .unwrap();

        let error = bob_device_2
            .remove_member("conv-self-leave", "ptid:test:bob")
            .expect_err("OpenMLS must reject self-removal commits");
        assert!(error.contains("CannotRemoveSelf"));
        assert!(!bob_device_2.has_pending_transition("conv-self-leave"));
    }

    fn accept_genesis(
        manager: &MlsGroupManager,
        conversation_id: &str,
        created: &MlsGroupCreateResult,
    ) {
        assert!(manager.has_pending_transition(conversation_id));
        assert!(
            manager.encrypt(conversation_id, b"blocked").is_err(),
            "send must be blocked before genesis acceptance"
        );
        manager
            .accept_pending_transition(conversation_id, &created.transition_id)
            .expect("accept genesis transition");
        assert_eq!(
            manager.group_epoch(conversation_id).expect("genesis epoch"),
            created.to_mls_epoch
        );
    }

    #[test]
    fn p3_group_create_encrypt_decrypt() {
        let alice_mgr = MlsGroupManager::new();
        let bob_mgr = MlsGroupManager::new();

        alice_mgr
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob_mgr
            .actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();

        let bob_kp = bob_mgr.generate_key_package().expect("bob kp");

        let result = alice_mgr
            .create_group(
                "conv-p3-test",
                &[member_key_package("ptid:test:bob", "bob-device", bob_kp)],
            )
            .expect("create group");

        assert!(!result.welcome_bytes.is_empty());
        assert!(!result.commit_bytes.is_empty());
        assert_eq!(result.from_mls_epoch, 0);
        assert_eq!(result.to_mls_epoch, 1);
        accept_genesis(&alice_mgr, "conv-p3-test", &result);

        bob_mgr
            .join_group("conv-p3-test", &result.welcome_bytes)
            .expect("bob join");

        let enc = alice_mgr
            .encrypt("conv-p3-test", b"hello group p3")
            .expect("encrypt");

        let plaintext = bob_mgr
            .decrypt("conv-p3-test", &enc.ciphertext)
            .expect("decrypt");

        assert_eq!(plaintext, b"hello group p3");
    }

    #[test]
    fn generated_key_package_pool_accepts_packages_before_the_latest() {
        let alice_mgr = MlsGroupManager::new();
        let bob_mgr = MlsGroupManager::new();

        alice_mgr
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob_mgr
            .actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();

        let first_bob_kp = bob_mgr.generate_key_package().expect("first bob kp");
        let _second_bob_kp = bob_mgr.generate_key_package().expect("second bob kp");
        let created = alice_mgr
            .create_group(
                "conv-key-pool",
                &[member_key_package(
                    "ptid:test:bob",
                    "bob-device",
                    first_bob_kp,
                )],
            )
            .expect("create group");
        accept_genesis(&alice_mgr, "conv-key-pool", &created);

        bob_mgr
            .join_group("conv-key-pool", &created.welcome_bytes)
            .expect("join with first pending key package");
    }

    #[test]
    fn key_package_provider_pool_survives_restart_before_welcome() {
        let alice = MlsGroupManager::new();
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob.actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();

        let bob_kp = bob.generate_key_package().expect("bob kp");
        let bob_identity = bob
            .actor_identity()
            .export("ptid:test:bob", "bob-device")
            .expect("bob identity");
        let provider_pool = bob
            .export_pending_join_providers()
            .expect("export provider pool");
        let restored_bob = MlsGroupManager::new();
        restored_bob
            .actor_identity()
            .import("ptid:test:bob", "bob-device", &bob_identity)
            .expect("restore identity");
        assert_eq!(
            restored_bob
                .import_pending_join_providers(&provider_pool)
                .expect("restore provider pool"),
            1
        );

        let created = alice
            .create_group(
                "conv-welcome-restart",
                &[member_key_package("ptid:test:bob", "bob-device", bob_kp)],
            )
            .expect("prepare genesis");
        accept_genesis(&alice, "conv-welcome-restart", &created);
        let prepared_join = restored_bob
            .prepare_received_welcome(
                "conv-welcome-restart",
                &created.welcome_bytes,
                &[MembershipTransitionChange {
                    ptid: "ptid:test:bob".to_string(),
                    action: MembershipTransitionAction::Add as i32,
                    device_id: "bob-device".to_string(),
                    ..Default::default()
                }],
            )
            .expect("prepare join after restart");
        assert!(!restored_bob.has_session("conv-welcome-restart"));
        restored_bob
            .prepare_received_welcome(
                "conv-welcome-restart",
                &created.welcome_bytes,
                &[MembershipTransitionChange {
                    ptid: "ptid:test:bob".to_string(),
                    action: MembershipTransitionAction::Add as i32,
                    device_id: "bob-device".to_string(),
                    ..Default::default()
                }],
            )
            .expect("preparation must not consume the KeyPackage");
        restored_bob
            .install_received_state("conv-welcome-restart", &prepared_join)
            .expect("install persisted join");

        let encrypted = alice
            .encrypt("conv-welcome-restart", b"welcome after restart")
            .expect("encrypt");
        assert_eq!(
            restored_bob
                .decrypt("conv-welcome-restart", &encrypted.ciphertext)
                .expect("decrypt"),
            b"welcome after restart"
        );
        let reply = restored_bob
            .encrypt("conv-welcome-restart", b"reply after restart")
            .expect("sign reply with restored device identity");
        assert_eq!(
            alice
                .decrypt("conv-welcome-restart", &reply.ciphertext)
                .expect("alice decrypt reply"),
            b"reply after restart"
        );
    }

    #[test]
    fn p3_add_member_commit_flow() {
        let alice_mgr = MlsGroupManager::new();
        let bob_mgr = MlsGroupManager::new();
        let charlie_mgr = MlsGroupManager::new();

        alice_mgr
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob_mgr
            .actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();
        charlie_mgr
            .actor_identity()
            .init("ptid:test:charlie", "charlie-device")
            .unwrap();

        let bob_kp = bob_mgr.generate_key_package().expect("bob kp");
        let result = alice_mgr
            .create_group(
                "conv-add-test",
                &[member_key_package("ptid:test:bob", "bob-device", bob_kp)],
            )
            .expect("create");
        accept_genesis(&alice_mgr, "conv-add-test", &result);
        bob_mgr
            .join_group("conv-add-test", &result.welcome_bytes)
            .expect("bob join");

        let charlie_kp = charlie_mgr.generate_key_package().expect("charlie kp");
        let prepared = alice_mgr
            .add_member(
                "conv-add-test",
                &member_key_package("ptid:test:charlie", "charlie-device", charlie_kp),
            )
            .expect("add charlie");
        assert!(alice_mgr.has_pending_transition("conv-add-test"));
        assert!(
            alice_mgr.encrypt("conv-add-test", b"blocked").is_err(),
            "send must be blocked before authority acceptance"
        );
        alice_mgr
            .accept_pending_transition("conv-add-test", &prepared.transition_id)
            .expect("accept add transition");

        let before_invalid_commit = bob_mgr.public_head("conv-add-test").unwrap();
        let corrupted_commit = &prepared.commit_bytes[..prepared.commit_bytes.len() / 2];
        assert!(bob_mgr
            .prepare_received_commit(
                "conv-add-test",
                corrupted_commit,
                &[MembershipTransitionChange {
                    ptid: "ptid:test:charlie".to_string(),
                    action: MembershipTransitionAction::Add as i32,
                    device_id: "charlie-device".to_string(),
                    ..Default::default()
                }],
            )
            .is_err());
        let after_invalid_commit = bob_mgr.public_head("conv-add-test").unwrap();
        assert_eq!(
            before_invalid_commit.mls_epoch,
            after_invalid_commit.mls_epoch
        );
        assert_eq!(
            before_invalid_commit.group_context_sha256,
            after_invalid_commit.group_context_sha256
        );
        assert_eq!(
            before_invalid_commit.ratchet_tree_sha256,
            after_invalid_commit.ratchet_tree_sha256
        );

        assert!(bob_mgr
            .prepare_received_commit(
                "conv-add-test",
                &prepared.commit_bytes,
                &[MembershipTransitionChange {
                    ptid: "ptid:test:charlie".to_string(),
                    action: MembershipTransitionAction::Add as i32,
                    device_id: "wrong-device".to_string(),
                    ..Default::default()
                }],
            )
            .is_err());
        let bob_receive = bob_mgr
            .prepare_received_commit(
                "conv-add-test",
                &prepared.commit_bytes,
                &[MembershipTransitionChange {
                    ptid: "ptid:test:charlie".to_string(),
                    action: MembershipTransitionAction::Add as i32,
                    device_id: "charlie-device".to_string(),
                    ..Default::default()
                }],
            )
            .expect("bob prepare commit");
        assert_eq!(bob_mgr.group_epoch("conv-add-test").expect("bob epoch"), 1);
        bob_mgr
            .install_received_state("conv-add-test", &bob_receive)
            .expect("bob install commit");
        charlie_mgr
            .join_group("conv-add-test", &prepared.welcome_bytes)
            .expect("charlie join");

        let enc = alice_mgr
            .encrypt("conv-add-test", b"all three")
            .expect("encrypt");

        let p_bob = bob_mgr
            .decrypt("conv-add-test", &enc.ciphertext)
            .expect("bob decrypt");
        let p_charlie = charlie_mgr
            .decrypt("conv-add-test", &enc.ciphertext)
            .expect("charlie decrypt");

        assert_eq!(p_bob, b"all three");
        assert_eq!(p_charlie, b"all three");
    }

    #[test]
    fn p3_remove_member_forward_secrecy() {
        let alice_mgr = MlsGroupManager::new();
        let bob_mgr = MlsGroupManager::new();

        alice_mgr
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob_mgr
            .actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();

        let bob_kp = bob_mgr.generate_key_package().expect("bob kp");
        let result = alice_mgr
            .create_group(
                "conv-remove-test",
                &[member_key_package("ptid:test:bob", "bob-device", bob_kp)],
            )
            .expect("create");
        accept_genesis(&alice_mgr, "conv-remove-test", &result);
        bob_mgr
            .join_group("conv-remove-test", &result.welcome_bytes)
            .expect("bob join");

        let prepared = alice_mgr
            .remove_member("conv-remove-test", "ptid:test:bob")
            .expect("remove bob");
        alice_mgr
            .accept_pending_transition("conv-remove-test", &prepared.transition_id)
            .expect("accept remove transition");

        let enc_after = alice_mgr
            .encrypt("conv-remove-test", b"secret after removal")
            .expect("encrypt after removal");

        let decrypt_result = bob_mgr.decrypt("conv-remove-test", &enc_after.ciphertext);
        assert!(
            decrypt_result.is_err(),
            "removed member should not decrypt post-removal messages"
        );

        drop(prepared);
    }

    #[test]
    fn rejected_transition_preserves_established_group_state() {
        let alice = MlsGroupManager::new();
        let bob = MlsGroupManager::new();
        let charlie = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob.actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();
        charlie
            .actor_identity()
            .init("ptid:test:charlie", "charlie-device")
            .unwrap();

        let bob_kp = bob.generate_key_package().expect("bob kp");
        let created = alice
            .create_group(
                "conv-reject",
                &[member_key_package("ptid:test:bob", "bob-device", bob_kp)],
            )
            .expect("create");
        accept_genesis(&alice, "conv-reject", &created);
        bob.join_group("conv-reject", &created.welcome_bytes)
            .expect("bob join");
        let before_epoch = alice.group_epoch("conv-reject").expect("epoch");
        let charlie_kp = charlie.generate_key_package().expect("charlie kp");
        alice
            .add_member(
                "conv-reject",
                &member_key_package("ptid:test:charlie", "charlie-device", charlie_kp),
            )
            .expect("prepare charlie");
        assert!(alice.discard_pending_transition("conv-reject"));
        assert!(!alice.has_pending_transition("conv-reject"));
        let after_epoch = alice.group_epoch("conv-reject").expect("epoch");
        assert_eq!(
            before_epoch, after_epoch,
            "rejection must not advance established MLS epoch"
        );
        assert!(alice.encrypt("conv-reject", b"still usable").is_ok());
    }

    #[test]
    fn pending_transition_survives_restart_until_exact_acceptance() {
        let alice = MlsGroupManager::new();
        let bob = MlsGroupManager::new();
        let charlie = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob.actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();
        charlie
            .actor_identity()
            .init("ptid:test:charlie", "charlie-device")
            .unwrap();
        let bob_kp = bob.generate_key_package().expect("bob kp");
        let created = alice
            .create_group(
                "conv-pending-restart",
                &[member_key_package("ptid:test:bob", "bob-device", bob_kp)],
            )
            .expect("create");
        accept_genesis(&alice, "conv-pending-restart", &created);
        bob.join_group("conv-pending-restart", &created.welcome_bytes)
            .expect("bob join");
        let established = alice
            .export_session_state("conv-pending-restart")
            .expect("established state");
        let charlie_kp = charlie.generate_key_package().expect("charlie kp");
        let prepared = alice
            .add_member(
                "conv-pending-restart",
                &member_key_package("ptid:test:charlie", "charlie-device", charlie_kp),
            )
            .expect("prepare");
        let pending = alice
            .export_pending_transition("conv-pending-restart")
            .expect("pending state");

        let restored = MlsGroupManager::new();
        restored
            .import_session_state("conv-pending-restart", &established)
            .expect("restore established");
        let recovered = restored
            .import_pending_transition("conv-pending-restart", &pending)
            .expect("restore pending");
        assert_eq!(recovered.transition_id, prepared.transition_id);
        assert!(restored
            .encrypt("conv-pending-restart", b"blocked")
            .is_err());
        assert!(restored
            .accept_pending_transition("conv-pending-restart", "wrong-transition")
            .is_err());
        restored
            .accept_pending_transition("conv-pending-restart", &prepared.transition_id)
            .expect("exact acceptance");
        assert_eq!(
            restored.group_epoch("conv-pending-restart").expect("epoch"),
            prepared.to_mls_epoch
        );
    }

    #[test]
    fn pending_genesis_survives_restart_without_established_state() {
        let alice = MlsGroupManager::new();
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob.actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();

        let bob_kp = bob.generate_key_package().expect("bob kp");
        let created = alice
            .create_group(
                "conv-genesis-restart",
                &[member_key_package("ptid:test:bob", "bob-device", bob_kp)],
            )
            .expect("prepare genesis");
        assert!(!alice.has_session("conv-genesis-restart"));
        let pending = alice
            .export_pending_transition("conv-genesis-restart")
            .expect("export pending genesis");

        let restored = MlsGroupManager::new();
        let recovered = restored
            .import_pending_transition("conv-genesis-restart", &pending)
            .expect("restore pending genesis");
        assert_eq!(recovered.transition_id, created.transition_id);
        assert!(!restored.has_session("conv-genesis-restart"));
        assert!(restored
            .accept_pending_transition("conv-genesis-restart", "wrong-transition")
            .is_err());
        restored
            .accept_pending_transition("conv-genesis-restart", &created.transition_id)
            .expect("accept exact genesis");
        assert_eq!(
            restored
                .group_epoch("conv-genesis-restart")
                .expect("accepted genesis epoch"),
            1
        );

        bob.join_group("conv-genesis-restart", &created.welcome_bytes)
            .expect("bob join");
        let encrypted = restored
            .encrypt("conv-genesis-restart", b"after genesis restart")
            .expect("encrypt after genesis acceptance");
        assert_eq!(
            bob.decrypt("conv-genesis-restart", &encrypted.ciphertext)
                .expect("bob decrypt"),
            b"after genesis restart"
        );
    }

    #[test]
    fn p3_independent_session_state_survives_cold_start() {
        let alice = MlsGroupManager::new();
        let bob = MlsGroupManager::new();
        alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        bob.actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();

        let bob_kp = bob.generate_key_package().expect("bob kp");
        let created = alice
            .create_group(
                "conv-cold-start",
                &[member_key_package("ptid:test:bob", "bob-device", bob_kp)],
            )
            .expect("create");
        accept_genesis(&alice, "conv-cold-start", &created);
        bob.join_group("conv-cold-start", &created.welcome_bytes)
            .expect("join");

        let alice_state = alice
            .export_session_state("conv-cold-start")
            .expect("export alice");
        let bob_state = bob
            .export_session_state("conv-cold-start")
            .expect("export bob");
        assert_ne!(
            alice_state, bob_state,
            "member states must remain independent"
        );

        let restored_alice = MlsGroupManager::new();
        let restored_bob = MlsGroupManager::new();
        restored_alice
            .actor_identity()
            .init("ptid:test:alice", "alice-device")
            .unwrap();
        restored_bob
            .actor_identity()
            .init("ptid:test:bob", "bob-device")
            .unwrap();
        restored_alice
            .import_session_state("conv-cold-start", &alice_state)
            .expect("restore alice");
        restored_bob
            .import_session_state("conv-cold-start", &bob_state)
            .expect("restore bob");

        let encrypted = restored_alice
            .encrypt("conv-cold-start", b"after cold start")
            .expect("encrypt");
        let plaintext = restored_bob
            .decrypt("conv-cold-start", &encrypted.ciphertext)
            .expect("decrypt");
        assert_eq!(plaintext, b"after cold start");
    }
}
