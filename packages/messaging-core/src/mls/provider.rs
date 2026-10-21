//! G0 L2 verification: openmls compiles in the Desktop Rust target and
//! MLS state can be persisted + restored (C-2).
//!
//! `PeersMLSProvider` is a thin wrapper around openmls primitives that
//! exposes mutable access to the `MemoryStorage` for save/load. It will
//! serve as the foundation for the P3 product MLS layer.

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_memory_storage::MemoryStorage;
use openmls_rust_crypto::RustCrypto;
use openmls_traits::OpenMlsProvider;
use std::collections::HashMap;
use std::sync::RwLock;

pub const PEERS_CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const MAX_MLS_PROVIDER_STATE_BYTES: usize = 64 * 1024 * 1024;
const MAX_MLS_PROVIDER_STATE_ENTRIES: usize = 100_000;

#[derive(Debug, Default)]
pub struct PeersMLSProvider {
    crypto: RustCrypto,
    storage: MemoryStorage,
}

impl PeersMLSProvider {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn storage_mut(&mut self) -> &mut MemoryStorage {
        &mut self.storage
    }

    pub fn export_state(&self) -> Result<Vec<u8>, String> {
        let values = self
            .storage
            .values
            .read()
            .map_err(|_| "messaging MLS storage lock poisoned".to_string())?;
        let mut entries = values.iter().collect::<Vec<_>>();
        entries.sort_by(|left, right| left.0.cmp(right.0));
        let mut bytes = Vec::new();
        write_u64(&mut bytes, entries.len() as u64);
        for (key, value) in entries {
            write_u64(&mut bytes, key.len() as u64);
            write_u64(&mut bytes, value.len() as u64);
            bytes.extend_from_slice(key);
            bytes.extend_from_slice(value);
        }
        if bytes.len() > MAX_MLS_PROVIDER_STATE_BYTES {
            return Err("messaging MLS storage exceeds the portable state bound".to_string());
        }
        Ok(bytes)
    }

    pub fn import_state(&mut self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > MAX_MLS_PROVIDER_STATE_BYTES {
            return Err("messaging MLS storage exceeds the portable state bound".to_string());
        }
        let mut cursor = 0;
        let count = read_u64(bytes, &mut cursor)?;
        let count = usize::try_from(count)
            .map_err(|_| "messaging MLS storage entry count is invalid".to_string())?;
        if count > MAX_MLS_PROVIDER_STATE_ENTRIES {
            return Err("messaging MLS storage entry count exceeds policy".to_string());
        }
        let mut values = HashMap::with_capacity(count);
        for _ in 0..count {
            let key_length = read_length(bytes, &mut cursor)?;
            let value_length = read_length(bytes, &mut cursor)?;
            let key = read_bytes(bytes, &mut cursor, key_length)?;
            let value = read_bytes(bytes, &mut cursor, value_length)?;
            if values.insert(key, value).is_some() {
                return Err("messaging MLS storage contains duplicate keys".to_string());
            }
        }
        if cursor != bytes.len() {
            return Err("messaging MLS storage has trailing bytes".to_string());
        }
        self.storage = MemoryStorage {
            values: RwLock::new(values),
        };
        Ok(())
    }
}

fn write_u64(bytes: &mut Vec<u8>, value: u64) {
    bytes.extend_from_slice(&value.to_be_bytes());
}

fn read_u64(bytes: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let end = cursor
        .checked_add(8)
        .ok_or_else(|| "messaging MLS storage length overflow".to_string())?;
    let encoded = bytes
        .get(*cursor..end)
        .ok_or_else(|| "messaging MLS storage is truncated".to_string())?;
    *cursor = end;
    Ok(u64::from_be_bytes(encoded.try_into().map_err(|_| {
        "messaging MLS storage integer is invalid".to_string()
    })?))
}

fn read_length(bytes: &[u8], cursor: &mut usize) -> Result<usize, String> {
    let length = read_u64(bytes, cursor)?;
    usize::try_from(length).map_err(|_| "messaging MLS storage field length is invalid".to_string())
}

fn read_bytes(bytes: &[u8], cursor: &mut usize, length: usize) -> Result<Vec<u8>, String> {
    let end = cursor
        .checked_add(length)
        .ok_or_else(|| "messaging MLS storage field length overflow".to_string())?;
    let value = bytes
        .get(*cursor..end)
        .ok_or_else(|| "messaging MLS storage is truncated".to_string())?
        .to_vec();
    *cursor = end;
    Ok(value)
}

#[cfg(test)]
fn corrupt_trailing_byte(mut bytes: Vec<u8>) -> Vec<u8> {
    bytes.push(0);
    bytes
}

#[cfg(test)]
fn corrupt_duplicate_key(bytes: &[u8]) -> Vec<u8> {
    let mut cursor = 8;
    let key_length = read_length(bytes, &mut cursor).unwrap();
    let value_length = read_length(bytes, &mut cursor).unwrap();
    let key = read_bytes(bytes, &mut cursor, key_length).unwrap();
    let value = read_bytes(bytes, &mut cursor, value_length).unwrap();
    let mut duplicate = Vec::new();
    write_u64(&mut duplicate, 2);
    for _ in 0..2 {
        write_u64(&mut duplicate, key.len() as u64);
        write_u64(&mut duplicate, value.len() as u64);
        duplicate.extend_from_slice(&key);
        duplicate.extend_from_slice(&value);
    }
    duplicate
}

impl OpenMlsProvider for PeersMLSProvider {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = MemoryStorage;

    fn storage(&self) -> &Self::StorageProvider {
        &self.storage
    }

    fn crypto(&self) -> &Self::CryptoProvider {
        &self.crypto
    }

    fn rand(&self) -> &Self::RandProvider {
        &self.crypto
    }
}

pub fn create_key_package(
    provider: &PeersMLSProvider,
    signer: &SignatureKeyPair,
    credential_with_key: CredentialWithKey,
) -> Result<KeyPackage, String> {
    KeyPackage::builder()
        .build(PEERS_CIPHERSUITE, provider, signer, credential_with_key)
        .map(|kpb| kpb.key_package().clone())
        .map_err(|e| format!("build key package: {e:?}"))
}

pub fn create_credential(identity: &[u8]) -> (SignatureKeyPair, CredentialWithKey) {
    let signer =
        SignatureKeyPair::new(PEERS_CIPHERSUITE.signature_algorithm()).expect("gen signer");
    let credential = BasicCredential::new(identity.to_vec());
    let credential_with_key = CredentialWithKey {
        credential: credential.into(),
        signature_key: signer.to_public_vec().into(),
    };
    (signer, credential_with_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c1_desktop_target_compilation() {
        let provider = PeersMLSProvider::new();
        let (signer, cwk) = create_credential(b"c1-test");
        let kp = create_key_package(&provider, &signer, cwk);
        assert!(kp.is_ok(), "KeyPackage creation failed: {:?}", kp.err());
    }

    #[test]
    fn c2_persistence_cold_start_recovery() {
        let (alice_signer, alice_cwk) = create_credential(b"alice");
        let (bob_signer, bob_cwk) = create_credential(b"bob");

        let alice_provider = PeersMLSProvider::new();
        let bob_provider = PeersMLSProvider::new();

        let bob_kp =
            create_key_package(&bob_provider, &bob_signer, bob_cwk.clone()).expect("bob kp");

        let mut alice_group = MlsGroup::builder()
            .ciphersuite(PEERS_CIPHERSUITE)
            .with_group_id(GroupId::from_slice(b"c2-test-group"))
            .use_ratchet_tree_extension(true)
            .build(&alice_provider, &alice_signer, alice_cwk.clone())
            .expect("create group");

        let (_mls_out, _welcome, _group_info) = alice_group
            .add_members(&alice_provider, &alice_signer, &[bob_kp])
            .expect("add bob");

        alice_group
            .merge_pending_commit(&alice_provider)
            .expect("merge");

        let _msg = alice_group
            .create_message(&alice_provider, &alice_signer, b"before-persist")
            .expect("encrypt msg");

        let encoded = alice_provider.export_state().expect("export state");

        let mut restored_provider = PeersMLSProvider::new();
        restored_provider
            .import_state(&encoded)
            .expect("import state");

        let restored_group = MlsGroup::load(
            restored_provider.storage(),
            &GroupId::from_slice(b"c2-test-group"),
        )
        .expect("load group from storage");

        assert!(restored_group.is_some(), "group not found after restore");
        let mut restored_group = restored_group.unwrap();

        let msg2 =
            restored_group.create_message(&restored_provider, &alice_signer, b"after-persist");

        assert!(
            msg2.is_ok(),
            "post-restore message encryption failed: {:?}",
            msg2.err()
        );
    }

    #[test]
    fn state_codec_rejects_trailing_bytes_and_duplicate_keys() {
        let provider = PeersMLSProvider::new();
        let (signer, credential) = create_credential(b"codec");
        create_key_package(&provider, &signer, credential).expect("persist key package");
        let encoded = provider.export_state().expect("export");

        assert!(PeersMLSProvider::new()
            .import_state(&corrupt_trailing_byte(encoded.clone()))
            .is_err());
        assert!(PeersMLSProvider::new()
            .import_state(&corrupt_duplicate_key(&encoded))
            .is_err());
    }

    #[test]
    fn state_codec_rejects_unbounded_entry_count_before_allocation() {
        let encoded = u64::MAX.to_be_bytes();

        assert!(PeersMLSProvider::new().import_state(&encoded).is_err());
    }

    #[test]
    fn state_codec_is_deterministic() {
        let provider = PeersMLSProvider::new();
        let (signer, credential) = create_credential(b"deterministic");
        create_key_package(&provider, &signer, credential).expect("persist key package");

        assert_eq!(
            provider.export_state().unwrap(),
            provider.export_state().unwrap()
        );
    }
}
