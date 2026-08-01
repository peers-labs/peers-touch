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
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

pub const PEERS_CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

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

    pub fn save_state(&self, name: &str) -> Result<(), String> {
        self.storage.save(name.to_string())
    }

    pub fn load_state(&mut self, name: &str) -> Result<(), String> {
        self.storage.load(name.to_string())
    }

    pub fn export_state(&self) -> Result<Vec<u8>, String> {
        let path = secure_temp_state_path()?;
        let file = create_secure_temp_file(&path)?;
        let result = self.storage.save_to_file(&file);
        drop(file);
        let bytes = result.and_then(|_| fs::read(&path).map_err(|e| e.to_string()));
        let _ = fs::remove_file(path);
        bytes
    }

    pub fn import_state(&mut self, bytes: &[u8]) -> Result<(), String> {
        let path = secure_temp_state_path()?;
        let mut file = create_secure_temp_file(&path)?;
        let result = file
            .write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string());
        drop(file);
        let result = result.and_then(|_| {
            let file = File::open(&path).map_err(|e| e.to_string())?;
            self.storage.load_from_file(&file)
        });
        let _ = fs::remove_file(path);
        result
    }
}

fn secure_temp_state_path() -> Result<PathBuf, String> {
    let root = std::env::var("PEERS_STORAGE_ROOT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = root.join("peers-touch").join("desktop").join("runtime").join("mls-export");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    Ok(dir.join(format!("{}.state", ulid::Ulid::new())))
}

fn create_secure_temp_file(path: &std::path::Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.create_new(true).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|e| e.to_string())
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
        let state_name = "peers_mls_c2_test";

        let (alice_signer, alice_cwk) = create_credential(b"alice");
        let (bob_signer, bob_cwk) = create_credential(b"bob");

        let alice_provider = PeersMLSProvider::new();
        let bob_provider = PeersMLSProvider::new();

        let bob_kp = create_key_package(&bob_provider, &bob_signer, bob_cwk.clone())
            .expect("bob kp");

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

        alice_provider
            .save_state(state_name)
            .expect("save state");

        let mut restored_provider = PeersMLSProvider::new();
        restored_provider
            .load_state(state_name)
            .expect("load state");

        let restored_group =
            MlsGroup::load(restored_provider.storage(), &GroupId::from_slice(b"c2-test-group"))
                .expect("load group from storage");

        assert!(restored_group.is_some(), "group not found after restore");
        let mut restored_group = restored_group.unwrap();

        let msg2 = restored_group
            .create_message(&restored_provider, &alice_signer, b"after-persist");

        assert!(
            msg2.is_ok(),
            "post-restore message encryption failed: {:?}",
            msg2.err()
        );

        let _ = std::fs::remove_file(
            std::env::temp_dir().join(format!("openmls_cli_{state_name}_ks.json"))
        );
    }
}
