use openmls::prelude::{BasicCredential, CredentialWithKey};
use openmls_basic_credential::SignatureKeyPair;
use openmls_traits::signatures::Signer;
use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

use super::mls::create_credential;
use crate::model::chat::MlsDeviceCredential;

pub const MLS_DEVICE_CREDENTIAL_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct PersistedActorDeviceIdentity {
    ptid: String,
    device_id: String,
    signer: SignatureKeyPair,
}

pub struct ActorDeviceIdentity {
    identity: Mutex<Option<(SignatureKeyPair, CredentialWithKey)>>,
}

impl ActorDeviceIdentity {
    pub fn new() -> Self {
        Self {
            identity: Mutex::new(None),
        }
    }

    pub fn init(&self, ptid: &str, device_id: &str) -> Result<(), String> {
        let identity = encode_device_credential(ptid, device_id)?;
        let (signer, credential) = create_credential(&identity);
        *self.identity.lock().unwrap() = Some((signer, credential));
        Ok(())
    }

    pub fn export(&self, ptid: &str, device_id: &str) -> Result<Vec<u8>, String> {
        encode_device_credential(ptid, device_id)?;
        let identity = self.identity.lock().unwrap();
        let (signer, credential) = identity.as_ref().ok_or("identity not initialized")?;
        let actual = decode_device_credential(credential.credential.serialized_content())?;
        if actual.ptid != ptid || actual.device_id != device_id {
            return Err("actor-device identity scope does not match export request".to_string());
        }
        serde_json::to_vec(&PersistedActorDeviceIdentity {
            ptid: ptid.to_string(),
            device_id: device_id.to_string(),
            signer: signer.clone(),
        })
        .map_err(|e| format!("serialize actor-device identity: {e}"))
    }

    pub fn import(
        &self,
        expected_ptid: &str,
        expected_device_id: &str,
        state_bytes: &[u8],
    ) -> Result<(), String> {
        let persisted: PersistedActorDeviceIdentity = serde_json::from_slice(state_bytes)
            .map_err(|e| format!("deserialize actor-device identity: {e}"))?;
        if persisted.ptid != expected_ptid || persisted.device_id != expected_device_id {
            return Err(
                "persisted actor-device identity belongs to a different actor device".to_string(),
            );
        }
        let identity = encode_device_credential(expected_ptid, expected_device_id)?;
        let credential = BasicCredential::new(identity);
        let credential_with_key = CredentialWithKey {
            credential: credential.into(),
            signature_key: persisted.signer.to_public_vec().into(),
        };
        *self.identity.lock().unwrap() = Some((persisted.signer, credential_with_key));
        Ok(())
    }

    pub fn signing_identity(&self) -> Result<(String, Vec<u8>), String> {
        let identity = self.identity.lock().unwrap();
        let (signer, _) = identity.as_ref().ok_or("identity not initialized")?;
        let public_key = signer.to_public_vec();
        let signing_key_id = format!("sha256:{}", hex::encode(Sha256::digest(&public_key)));
        Ok((signing_key_id, public_key))
    }

    pub fn sign(&self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        let identity = self.identity.lock().unwrap();
        let (signer, _) = identity.as_ref().ok_or("identity not initialized")?;
        signer
            .sign(bytes)
            .map_err(|e| format!("sign actor bytes: {e:?}"))
    }

    pub fn snapshot(&self) -> Result<(SignatureKeyPair, CredentialWithKey), String> {
        self.identity
            .lock()
            .unwrap()
            .as_ref()
            .cloned()
            .ok_or_else(|| "identity not initialized".to_string())
    }
}

pub fn encode_device_credential(ptid: &str, device_id: &str) -> Result<Vec<u8>, String> {
    if !ptid.starts_with("ptid:") {
        return Err("MLS device credential requires a canonical PTID".to_string());
    }
    if device_id.trim().is_empty() {
        return Err("MLS device credential requires device_id".to_string());
    }
    Ok(MlsDeviceCredential {
        version: MLS_DEVICE_CREDENTIAL_VERSION,
        ptid: ptid.to_string(),
        device_id: device_id.to_string(),
    }
    .encode_to_vec())
}

pub fn decode_device_credential(identity: &[u8]) -> Result<MlsDeviceCredential, String> {
    let credential = MlsDeviceCredential::decode(identity)
        .map_err(|_| "MLS leaf credential is not MlsDeviceCredential".to_string())?;
    if credential.version != MLS_DEVICE_CREDENTIAL_VERSION {
        return Err("MLS leaf credential version is unsupported".to_string());
    }
    encode_device_credential(&credential.ptid, &credential.device_id)?;
    if credential.encode_to_vec() != identity {
        return Err("MLS leaf credential encoding is not canonical".to_string());
    }
    Ok(credential)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn persisted_identity_preserves_key_and_scope() {
        let original = ActorDeviceIdentity::new();
        original.init("ptid:test:alice", "alice-device").unwrap();
        let before = original.signing_identity().unwrap();
        let state = original.export("ptid:test:alice", "alice-device").unwrap();

        let restored = ActorDeviceIdentity::new();
        restored
            .import("ptid:test:alice", "alice-device", &state)
            .unwrap();
        assert_eq!(restored.signing_identity().unwrap(), before);
        assert!(ActorDeviceIdentity::new()
            .import("ptid:test:alice", "other-device", &state)
            .is_err());
        assert!(ActorDeviceIdentity::new()
            .import("ptid:test:bob", "alice-device", &state)
            .is_err());
    }

    #[test]
    fn corrupted_state_does_not_generate_replacement_identity() {
        let identity = ActorDeviceIdentity::new();
        assert!(identity
            .import("ptid:test:alice", "alice-device", b"invalid")
            .is_err());
        assert!(identity.signing_identity().is_err());
    }

    #[test]
    fn shared_identity_has_one_key_across_runtime_consumers() {
        let identity = Arc::new(ActorDeviceIdentity::new());
        identity.init("ptid:test:alice", "alice-device").unwrap();
        let first_consumer = identity.clone();
        let second_consumer = identity.clone();

        assert_eq!(
            first_consumer.signing_identity().unwrap(),
            second_consumer.signing_identity().unwrap()
        );
        assert_eq!(
            first_consumer.sign(b"same-input").unwrap(),
            second_consumer.sign(b"same-input").unwrap()
        );
    }
}
