use openmls::prelude::*;
use openmls::key_packages::KeyPackageIn;
use openmls_basic_credential::SignatureKeyPair;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Mutex;
use tls_codec::{Serialize as TlsSerializeTrait, Deserialize as TlsDeserializeTrait};

use super::mls::{create_credential, create_key_package, PeersMLSProvider, PEERS_CIPHERSUITE};

#[derive(Debug, Serialize, Deserialize)]
pub struct MlsGroupCreateResult {
    pub group_id: String,
    pub welcome_bytes: Vec<u8>,
    pub commit_bytes: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MlsGroupEncryptResult {
    pub ciphertext: Vec<u8>,
}

pub struct MlsGroupSession {
    provider: PeersMLSProvider,
    signer: SignatureKeyPair,
    group: MlsGroup,
}

pub struct MlsGroupManager {
    sessions: Mutex<HashMap<String, MlsGroupSession>>,
    identity: Mutex<Option<(SignatureKeyPair, CredentialWithKey)>>,
    pending_join_provider: Mutex<Option<PeersMLSProvider>>,
}

impl MlsGroupManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            identity: Mutex::new(None),
            pending_join_provider: Mutex::new(None),
        }
    }

    pub fn init_identity(&self, actor_did: &str) {
        let (signer, cwk) = create_credential(actor_did.as_bytes());
        let mut id = self.identity.lock().unwrap();
        *id = Some((signer, cwk));
    }

    pub fn generate_key_package(&self) -> Result<Vec<u8>, String> {
        let id = self.identity.lock().unwrap();
        let (signer, cwk) = id.as_ref().ok_or("identity not initialized")?;
        let provider = PeersMLSProvider::new();
        let kp = create_key_package(&provider, signer, cwk.clone())?;
        let kp_bytes = kp
            .tls_serialize_detached()
            .map_err(|e| format!("serialize key package: {e:?}"))?;
        let mut pending = self.pending_join_provider.lock().unwrap();
        *pending = Some(provider);
        Ok(kp_bytes)
    }

    pub fn create_group(
        &self,
        conversation_id: &str,
        member_key_packages: &[Vec<u8>],
    ) -> Result<MlsGroupCreateResult, String> {
        let id = self.identity.lock().unwrap();
        let (signer, cwk) = id.as_ref().ok_or("identity not initialized")?.clone();
        drop(id);

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

        if !member_key_packages.is_empty() {
            let kps: Result<Vec<KeyPackage>, _> = member_key_packages
                .iter()
                .map(|b| {
                    let kp_in = KeyPackageIn::tls_deserialize(&mut Cursor::new(b))
                        .map_err(|e| format!("deserialize kp: {e:?}"))?;
                    kp_in
                        .validate(provider.crypto(), ProtocolVersion::Mls10)
                        .map_err(|e| format!("validate kp: {e:?}"))
                })
                .collect();
            let kps = kps?;

            let (mls_out, welcome, _group_info) = group
                .add_members(&provider, &signer, kps.as_slice())
                .map_err(|e| format!("add members: {e:?}"))?;

            group
                .merge_pending_commit(&provider)
                .map_err(|e| format!("merge commit: {e:?}"))?;

            commit_bytes = mls_out
                .tls_serialize_detached()
                .map_err(|e| format!("serialize commit: {e:?}"))?;
            welcome_bytes = welcome
                .tls_serialize_detached()
                .map_err(|e| format!("serialize welcome: {e:?}"))?;
        }

        let session = MlsGroupSession {
            provider,
            signer,
            group,
        };

        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(conversation_id.to_string(), session);

        Ok(MlsGroupCreateResult {
            group_id: conversation_id.to_string(),
            welcome_bytes,
            commit_bytes,
        })
    }

    pub fn join_group(
        &self,
        conversation_id: &str,
        welcome_bytes: &[u8],
    ) -> Result<(), String> {
        let id = self.identity.lock().unwrap();
        let (signer, _cwk) = id.as_ref().ok_or("identity not initialized")?.clone();
        drop(id);

        let provider = self.pending_join_provider.lock().unwrap().take()
            .unwrap_or_else(PeersMLSProvider::new);

        let welcome = MlsMessageIn::tls_deserialize(&mut Cursor::new(welcome_bytes))
            .map_err(|e| format!("deserialize welcome: {e:?}"))?;

        let welcome = welcome
            .into_welcome()
            .ok_or("message is not a Welcome")?;

        let mls_group_config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .build();

        let group = StagedWelcome::new_from_welcome(&provider, &mls_group_config, welcome, None)
            .map_err(|e| format!("stage welcome: {e:?}"))?
            .into_group(&provider)
            .map_err(|e| format!("join group: {e:?}"))?;

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

    pub fn decrypt(
        &self,
        conversation_id: &str,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, String> {
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
            ProcessedMessageContent::ApplicationMessage(app_msg) => {
                Ok(app_msg.into_bytes())
            }
            ProcessedMessageContent::StagedCommitMessage(_) => {
                Err("unexpected commit message in decrypt path".to_string())
            }
            ProcessedMessageContent::ProposalMessage(_) => {
                Err("unexpected proposal in decrypt path".to_string())
            }
            _ => Err("unknown message content type".to_string()),
        }
    }

    pub fn process_commit(
        &self,
        conversation_id: &str,
        commit_bytes: &[u8],
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(conversation_id)
            .ok_or("no MLS session for this conversation")?;

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
                Ok(())
            }
            _ => Err("expected commit message".to_string()),
        }
    }

    pub fn add_member(
        &self,
        conversation_id: &str,
        member_key_package_bytes: &[u8],
    ) -> Result<(Vec<u8>, Vec<u8>), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(conversation_id)
            .ok_or("no MLS session for this conversation")?;

        let kp_in = KeyPackageIn::tls_deserialize(&mut Cursor::new(member_key_package_bytes))
            .map_err(|e| format!("deserialize kp: {e:?}"))?;
        let kp = kp_in
            .validate(session.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(|e| format!("validate kp: {e:?}"))?;

        let (mls_out, welcome, _group_info) = session
            .group
            .add_members(&session.provider, &session.signer, &[kp])
            .map_err(|e| format!("add member: {e:?}"))?;

        session
            .group
            .merge_pending_commit(&session.provider)
            .map_err(|e| format!("merge pending commit: {e:?}"))?;

        let commit_bytes = mls_out
            .tls_serialize_detached()
            .map_err(|e| format!("serialize commit: {e:?}"))?;
        let welcome_bytes = welcome
            .tls_serialize_detached()
            .map_err(|e| format!("serialize welcome: {e:?}"))?;

        Ok((commit_bytes, welcome_bytes))
    }

    pub fn remove_member(
        &self,
        conversation_id: &str,
        member_index: u32,
    ) -> Result<Vec<u8>, String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(conversation_id)
            .ok_or("no MLS session for this conversation")?;

        let leaf_index = LeafNodeIndex::new(member_index);
        let (mls_out, _welcome, _group_info) = session
            .group
            .remove_members(&session.provider, &session.signer, &[leaf_index])
            .map_err(|e| format!("remove member: {e:?}"))?;

        session
            .group
            .merge_pending_commit(&session.provider)
            .map_err(|e| format!("merge commit: {e:?}"))?;

        let commit_bytes = mls_out
            .tls_serialize_detached()
            .map_err(|e| format!("serialize commit: {e:?}"))?;

        Ok(commit_bytes)
    }

    pub fn save_session(&self, conversation_id: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(conversation_id)
            .ok_or("no MLS session for this conversation")?;
        session.provider.save_state(&format!("peers_mls_{conversation_id}"))
    }

    pub fn load_session(&self, conversation_id: &str) -> Result<(), String> {
        let id = self.identity.lock().unwrap();
        let (signer, _cwk) = id.as_ref().ok_or("identity not initialized")?.clone();
        drop(id);

        let mut provider = PeersMLSProvider::new();
        provider.load_state(&format!("peers_mls_{conversation_id}"))?;

        let group_id = GroupId::from_slice(conversation_id.as_bytes());
        let group = MlsGroup::load(provider.storage(), &group_id)
            .map_err(|e| format!("load group: {e:?}"))?
            .ok_or("group not found in storage")?;

        let session = MlsGroupSession {
            provider,
            signer,
            group,
        };

        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(conversation_id.to_string(), session);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn p3_group_create_encrypt_decrypt() {
        let alice_mgr = MlsGroupManager::new();
        let bob_mgr = MlsGroupManager::new();

        alice_mgr.init_identity("did:alice");
        bob_mgr.init_identity("did:bob");

        let bob_kp = bob_mgr.generate_key_package().expect("bob kp");

        let result = alice_mgr
            .create_group("conv-p3-test", &[bob_kp])
            .expect("create group");

        assert!(!result.welcome_bytes.is_empty());
        assert!(!result.commit_bytes.is_empty());

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
    fn p3_add_member_commit_flow() {
        let alice_mgr = MlsGroupManager::new();
        let bob_mgr = MlsGroupManager::new();
        let charlie_mgr = MlsGroupManager::new();

        alice_mgr.init_identity("did:alice");
        bob_mgr.init_identity("did:bob");
        charlie_mgr.init_identity("did:charlie");

        let bob_kp = bob_mgr.generate_key_package().expect("bob kp");
        let result = alice_mgr
            .create_group("conv-add-test", &[bob_kp])
            .expect("create");
        bob_mgr
            .join_group("conv-add-test", &result.welcome_bytes)
            .expect("bob join");

        let charlie_kp = charlie_mgr.generate_key_package().expect("charlie kp");
        let (commit_bytes, welcome_bytes) = alice_mgr
            .add_member("conv-add-test", &charlie_kp)
            .expect("add charlie");

        bob_mgr
            .process_commit("conv-add-test", &commit_bytes)
            .expect("bob process commit");
        charlie_mgr
            .join_group("conv-add-test", &welcome_bytes)
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

        alice_mgr.init_identity("did:alice");
        bob_mgr.init_identity("did:bob");

        let bob_kp = bob_mgr.generate_key_package().expect("bob kp");
        let result = alice_mgr
            .create_group("conv-remove-test", &[bob_kp])
            .expect("create");
        bob_mgr
            .join_group("conv-remove-test", &result.welcome_bytes)
            .expect("bob join");

        let commit_bytes = alice_mgr
            .remove_member("conv-remove-test", 1)
            .expect("remove bob");

        let enc_after = alice_mgr
            .encrypt("conv-remove-test", b"secret after removal")
            .expect("encrypt after removal");

        let decrypt_result = bob_mgr.decrypt("conv-remove-test", &enc_after.ciphertext);
        assert!(
            decrypt_result.is_err(),
            "removed member should not decrypt post-removal messages"
        );

        drop(commit_bytes);
    }
}
