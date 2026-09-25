use std::fs;

use aes_gcm::aead::{Aead, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use zeroize::Zeroizing;

use super::codec::{atomic_write, read_file, remove_regular_file_if_exists, Decoder, Encoder};
use super::error::{ReliabilityError, ReliabilityErrorKind, ReliabilityResult};
use super::key_vault::{KeyVault, INSTALL_KEK_RECORD_ID, SCOPE_DEK_RECORD_PREFIX};
use super::quarantine::{LegacyQuarantine, LegacyQuarantineState};
use super::reset::{ReliabilityReset, ReliabilityResetStatus};
use super::root::{CanonicalReliabilityRoot, CanonicalScopePaths};
use super::scope::{authenticated_context, ExactScope, RELIABILITY_SCHEMA_REVISION};

const INSTALL_RECORD_VERSION: u16 = 1;
const WRAPPED_SCOPE_RECORD_VERSION: u16 = 1;
const AEAD_AES_256_GCM: u8 = 1;
const INSTALL_EPOCH_BYTES: usize = 32;
const KEK_ID_BYTES: usize = 16;
const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 12;
const WRAPPED_KEY_BYTES: usize = KEY_BYTES + 16;
const MAX_INSTALL_RECORD_BYTES: usize = 256;
const MAX_ORPHAN_SCOPE_KEY_RECORDS: usize = 4096;

pub struct ReliabilityKeyManager<'a, V: KeyVault> {
    root: &'a CanonicalReliabilityRoot,
    vault: &'a V,
    install: InstallKey,
}

pub struct ActivatedReliabilityScope {
    context: ScopeKeyContext,
    paths: CanonicalScopePaths,
    command_key: Zeroizing<[u8; KEY_BYTES]>,
    draft_key: Zeroizing<[u8; KEY_BYTES]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeKeyContext {
    kek_id: [u8; KEK_ID_BYTES],
    install_epoch: [u8; INSTALL_EPOCH_BYTES],
    scope: ExactScope,
    schema_revision: u32,
}

struct InstallKey {
    kek_id: [u8; KEK_ID_BYTES],
    install_epoch: [u8; INSTALL_EPOCH_BYTES],
    key: Zeroizing<[u8; KEY_BYTES]>,
}

impl<'a, V: KeyVault> ReliabilityKeyManager<'a, V> {
    pub fn initialize(root: &'a CanonicalReliabilityRoot, vault: &'a V) -> ReliabilityResult<Self> {
        if !matches!(
            ReliabilityReset::status(root)?,
            ReliabilityResetStatus::Ready
        ) {
            return Err(ReliabilityError::new(
                ReliabilityErrorKind::ResetIncomplete,
                "reliability reset journal must resume before scope activation",
            ));
        }
        if !matches!(
            LegacyQuarantine::status(root)?,
            LegacyQuarantineState::Clean
        ) {
            return Err(ReliabilityError::new(
                ReliabilityErrorKind::LegacyDispositionRequired,
                "legacy v1 archive requires retain, discard, or reset action",
            ));
        }
        let has_ciphertext = root.has_any_ciphertext()?;
        let epoch = load_epoch_for_recovery(root, has_ciphertext)?;
        let raw_install = vault.load(INSTALL_KEK_RECORD_ID)?;
        let install = match (epoch, raw_install) {
            (Some(epoch), Some(raw)) => match decode_install_key(&raw) {
                Ok(install) if install.install_epoch == epoch => install,
                Ok(_) => {
                    if has_ciphertext {
                        return Err(ReliabilityError::new(
                            ReliabilityErrorKind::EpochMismatch,
                            "secure install key belongs to a different app-data epoch",
                        ));
                    }
                    rotate_orphaned_install_key(vault, epoch)?
                }
                Err(error) => {
                    if has_ciphertext {
                        return Err(error);
                    }
                    rotate_orphaned_install_key(vault, epoch)?
                }
            },
            (Some(epoch), None) => {
                if has_ciphertext {
                    return Err(ReliabilityError::key_unavailable(
                        "install key is missing while reliability ciphertext exists",
                    ));
                }
                rotate_orphaned_install_key(vault, epoch)?
            }
            (None, Some(_)) => {
                if has_ciphertext {
                    return Err(ReliabilityError::new(
                        ReliabilityErrorKind::EpochMismatch,
                        "app-data install epoch is missing while reliability ciphertext exists",
                    ));
                }
                let epoch = create_install_epoch(root)?;
                rotate_orphaned_install_key(vault, epoch)?
            }
            (None, None) => {
                if has_ciphertext {
                    return Err(ReliabilityError::key_unavailable(
                        "install key and app-data epoch are missing while reliability ciphertext exists",
                    ));
                }
                let epoch = create_install_epoch(root)?;
                rotate_orphaned_install_key(vault, epoch)?
            }
        };

        Ok(Self {
            root,
            vault,
            install,
        })
    }

    pub fn activate_scope(
        &self,
        scope: ExactScope,
    ) -> ReliabilityResult<ActivatedReliabilityScope> {
        let paths = self.root.scope_paths(&scope);
        let record_id = scope_record_id(&scope);
        let scope_key = match self.vault.load(&record_id)? {
            Some(record) => self.unwrap_scope_key(&scope, &record)?,
            None => {
                if self.root.has_scope_ciphertext(&scope)? {
                    return Err(ReliabilityError::key_unavailable(
                        "scope key is missing while exact-scope ciphertext exists",
                    ));
                }
                let mut scope_key = Zeroizing::new([0u8; KEY_BYTES]);
                OsRng.fill_bytes(scope_key.as_mut());
                let record = self.wrap_scope_key(&scope, &scope_key)?;
                self.vault.store(&record_id, &record)?;
                scope_key
            }
        };
        derive_scope_keys(
            ScopeKeyContext {
                kek_id: self.install.kek_id,
                install_epoch: self.install.install_epoch,
                scope,
                schema_revision: RELIABILITY_SCHEMA_REVISION,
            },
            paths,
            &scope_key,
        )
    }

    fn wrap_scope_key(
        &self,
        scope: &ExactScope,
        scope_key: &[u8; KEY_BYTES],
    ) -> ReliabilityResult<Vec<u8>> {
        let aad = scope_wrap_aad(&self.install.kek_id, &self.install.install_epoch, scope)?;
        let cipher = Aes256Gcm::new_from_slice(self.install.key.as_ref())
            .map_err(|_| ReliabilityError::authentication("invalid install KEK length"))?;
        let mut nonce_bytes = [0u8; NONCE_BYTES];
        OsRng.fill_bytes(&mut nonce_bytes);
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce_bytes),
                Payload {
                    msg: scope_key,
                    aad: &aad,
                },
            )
            .map_err(|_| ReliabilityError::authentication("scope DEK wrapping failed"))?;
        if ciphertext.len() != WRAPPED_KEY_BYTES {
            return Err(ReliabilityError::corrupt(
                "scope DEK wrapping produced an unexpected length",
            ));
        }
        let mut encoder = Encoder::new(b"PTWK");
        encoder.u16(WRAPPED_SCOPE_RECORD_VERSION);
        encoder.u8(AEAD_AES_256_GCM);
        encoder.fixed(&nonce_bytes);
        encoder.fixed(&ciphertext);
        Ok(encoder.finish())
    }

    fn unwrap_scope_key(
        &self,
        scope: &ExactScope,
        record: &[u8],
    ) -> ReliabilityResult<Zeroizing<[u8; KEY_BYTES]>> {
        let mut decoder = Decoder::new(record, b"PTWK")?;
        if decoder.u16()? != WRAPPED_SCOPE_RECORD_VERSION || decoder.u8()? != AEAD_AES_256_GCM {
            return Err(ReliabilityError::corrupt(
                "unsupported wrapped scope-key record",
            ));
        }
        let nonce = decoder.take_fixed::<NONCE_BYTES>()?;
        let ciphertext = decoder.take_fixed::<WRAPPED_KEY_BYTES>()?;
        decoder.finish()?;

        let aad = scope_wrap_aad(&self.install.kek_id, &self.install.install_epoch, scope)?;
        let cipher = Aes256Gcm::new_from_slice(self.install.key.as_ref())
            .map_err(|_| ReliabilityError::authentication("invalid install KEK length"))?;
        let plaintext = Zeroizing::new(
            cipher
                .decrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &ciphertext,
                        aad: &aad,
                    },
                )
                .map_err(|_| {
                    ReliabilityError::authentication(
                        "scope key failed KEK, epoch, or exact-scope authentication",
                    )
                })?,
        );
        if plaintext.len() != KEY_BYTES {
            return Err(ReliabilityError::corrupt(
                "unwrapped scope DEK has an invalid length",
            ));
        }
        let mut scope_key = Zeroizing::new([0u8; KEY_BYTES]);
        scope_key.copy_from_slice(&plaintext);
        Ok(scope_key)
    }
}

impl ActivatedReliabilityScope {
    pub fn context(&self) -> &ScopeKeyContext {
        &self.context
    }

    pub fn paths(&self) -> &CanonicalScopePaths {
        &self.paths
    }

    pub fn command_key(&self) -> &[u8; KEY_BYTES] {
        &self.command_key
    }

    pub fn draft_key(&self) -> &[u8; KEY_BYTES] {
        &self.draft_key
    }
}

impl ScopeKeyContext {
    pub fn kek_id(&self) -> &[u8; KEK_ID_BYTES] {
        &self.kek_id
    }

    pub fn install_epoch(&self) -> &[u8; INSTALL_EPOCH_BYTES] {
        &self.install_epoch
    }

    pub fn scope(&self) -> &ExactScope {
        &self.scope
    }

    pub fn schema_revision(&self) -> u32 {
        self.schema_revision
    }

    pub(crate) fn authenticated_context(
        &self,
        domain: &[u8],
        extra_fields: &[&[u8]],
    ) -> ReliabilityResult<Vec<u8>> {
        authenticated_context(
            domain,
            &self.kek_id,
            &self.install_epoch,
            &self.scope,
            self.schema_revision,
            extra_fields,
        )
    }
}

pub(crate) fn scope_record_id(scope: &ExactScope) -> String {
    format!("{SCOPE_DEK_RECORD_PREFIX}{}", scope.stable_token())
}

fn load_epoch_for_recovery(
    root: &CanonicalReliabilityRoot,
    has_ciphertext: bool,
) -> ReliabilityResult<Option<[u8; INSTALL_EPOCH_BYTES]>> {
    match load_install_epoch(root) {
        Ok(epoch) => Ok(epoch),
        Err(_error) if !has_ciphertext => {
            remove_regular_file_if_exists(&root.install_epoch_path())?;
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

fn load_install_epoch(
    root: &CanonicalReliabilityRoot,
) -> ReliabilityResult<Option<[u8; INSTALL_EPOCH_BYTES]>> {
    let path = root.install_epoch_path();
    match fs::symlink_metadata(&path) {
        Ok(_) => {
            let bytes = read_file(&path, 64)?;
            let mut decoder = Decoder::new(&bytes, b"PTRE")?;
            if decoder.u16()? != INSTALL_RECORD_VERSION {
                return Err(ReliabilityError::corrupt(
                    "unsupported install-epoch record version",
                ));
            }
            let epoch = decoder.take_fixed::<INSTALL_EPOCH_BYTES>()?;
            decoder.finish()?;
            Ok(Some(epoch))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ReliabilityError::io("inspect install epoch", error)),
    }
}

fn create_install_epoch(
    root: &CanonicalReliabilityRoot,
) -> ReliabilityResult<[u8; INSTALL_EPOCH_BYTES]> {
    let mut epoch = [0u8; INSTALL_EPOCH_BYTES];
    OsRng.fill_bytes(&mut epoch);
    let mut encoder = Encoder::new(b"PTRE");
    encoder.u16(INSTALL_RECORD_VERSION);
    encoder.fixed(&epoch);
    atomic_write(&root.install_epoch_path(), &encoder.finish())?;
    Ok(epoch)
}

fn create_install_key<V: KeyVault>(
    vault: &V,
    install_epoch: [u8; INSTALL_EPOCH_BYTES],
) -> ReliabilityResult<InstallKey> {
    let mut kek_id = [0u8; KEK_ID_BYTES];
    let mut key = Zeroizing::new([0u8; KEY_BYTES]);
    OsRng.fill_bytes(&mut kek_id);
    OsRng.fill_bytes(key.as_mut());
    let install = InstallKey {
        kek_id,
        install_epoch,
        key,
    };
    vault.store(INSTALL_KEK_RECORD_ID, &encode_install_key(&install))?;
    Ok(install)
}

fn rotate_orphaned_install_key<V: KeyVault>(
    vault: &V,
    install_epoch: [u8; INSTALL_EPOCH_BYTES],
) -> ReliabilityResult<InstallKey> {
    let mut scope_record_ids = vault.list(SCOPE_DEK_RECORD_PREFIX)?;
    scope_record_ids.sort();
    scope_record_ids.dedup();
    if scope_record_ids.len() > MAX_ORPHAN_SCOPE_KEY_RECORDS
        || scope_record_ids
            .iter()
            .any(|record_id| !record_id.starts_with(SCOPE_DEK_RECORD_PREFIX))
    {
        return Err(ReliabilityError::corrupt(
            "KeyVault returned an invalid orphaned scope-key inventory",
        ));
    }
    for record_id in scope_record_ids {
        vault.delete(&record_id)?;
    }
    vault.delete(INSTALL_KEK_RECORD_ID)?;
    create_install_key(vault, install_epoch)
}

fn encode_install_key(install: &InstallKey) -> Vec<u8> {
    let mut encoder = Encoder::new(b"PTRK");
    encoder.u16(INSTALL_RECORD_VERSION);
    encoder.u8(AEAD_AES_256_GCM);
    encoder.fixed(&install.kek_id);
    encoder.fixed(&install.install_epoch);
    encoder.fixed(install.key.as_ref());
    encoder.finish()
}

fn decode_install_key(bytes: &[u8]) -> ReliabilityResult<InstallKey> {
    if bytes.len() > MAX_INSTALL_RECORD_BYTES {
        return Err(ReliabilityError::corrupt(
            "install key record exceeds size limit",
        ));
    }
    let mut decoder = Decoder::new(bytes, b"PTRK")?;
    if decoder.u16()? != INSTALL_RECORD_VERSION || decoder.u8()? != AEAD_AES_256_GCM {
        return Err(ReliabilityError::corrupt("unsupported install key record"));
    }
    let kek_id = decoder.take_fixed::<KEK_ID_BYTES>()?;
    let install_epoch = decoder.take_fixed::<INSTALL_EPOCH_BYTES>()?;
    let mut key = Zeroizing::new([0u8; KEY_BYTES]);
    key.copy_from_slice(&decoder.take_fixed::<KEY_BYTES>()?);
    decoder.finish()?;
    Ok(InstallKey {
        kek_id,
        install_epoch,
        key,
    })
}

fn scope_wrap_aad(
    kek_id: &[u8; KEK_ID_BYTES],
    install_epoch: &[u8; INSTALL_EPOCH_BYTES],
    scope: &ExactScope,
) -> ReliabilityResult<Vec<u8>> {
    authenticated_context(
        b"scope-dek-wrap/aes-256-gcm/v1",
        kek_id,
        install_epoch,
        scope,
        RELIABILITY_SCHEMA_REVISION,
        &[b"random-256-bit-scope-dek"],
    )
}

fn derive_scope_keys(
    context: ScopeKeyContext,
    paths: CanonicalScopePaths,
    scope_key: &[u8; KEY_BYTES],
) -> ReliabilityResult<ActivatedReliabilityScope> {
    let hkdf = Hkdf::<Sha256>::new(Some(b"peers-touch/mobile/reliability/v2"), scope_key);
    let mut command_key = Zeroizing::new([0u8; KEY_BYTES]);
    let mut draft_key = Zeroizing::new([0u8; KEY_BYTES]);
    let command_info = context.authenticated_context(b"hkdf-command-ledger", &[b"aes-256-gcm"])?;
    let draft_info = context.authenticated_context(b"hkdf-draft-store", &[b"aes-256-gcm"])?;
    hkdf.expand(&command_info, command_key.as_mut())
        .map_err(|_| ReliabilityError::authentication("derive command-ledger key"))?;
    hkdf.expand(&draft_info, draft_key.as_mut())
        .map_err(|_| ReliabilityError::authentication("derive draft-store key"))?;
    Ok(ActivatedReliabilityScope {
        context,
        paths,
        command_key,
        draft_key,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct MemoryVault {
        records: Mutex<BTreeMap<String, Vec<u8>>>,
    }

    impl KeyVault for MemoryVault {
        fn load(&self, record_id: &str) -> ReliabilityResult<Option<Zeroizing<Vec<u8>>>> {
            Ok(self
                .records
                .lock()
                .unwrap()
                .get(record_id)
                .cloned()
                .map(Zeroizing::new))
        }

        fn store(&self, record_id: &str, value: &[u8]) -> ReliabilityResult<()> {
            self.records
                .lock()
                .unwrap()
                .insert(record_id.to_string(), value.to_vec());
            Ok(())
        }

        fn delete(&self, record_id: &str) -> ReliabilityResult<()> {
            self.records.lock().unwrap().remove(record_id);
            Ok(())
        }

        fn list(&self, prefix: &str) -> ReliabilityResult<Vec<String>> {
            Ok(self
                .records
                .lock()
                .unwrap()
                .keys()
                .filter(|key| key.starts_with(prefix))
                .cloned()
                .collect())
        }
    }

    struct TempAppData(PathBuf);

    impl TempAppData {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "pt-key-hierarchy-{}-{}",
                std::process::id(),
                ulid::Ulid::new()
            ));
            Self(path)
        }
    }

    impl Drop for TempAppData {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn keys_are_stable_per_scope_and_domain_separated() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let scope = ExactScope::new("station-a", "ptid-a").unwrap();

        let hierarchy = ReliabilityKeyManager::initialize(&root, &vault).unwrap();
        let first = hierarchy.activate_scope(scope.clone()).unwrap();
        assert_ne!(first.command_key(), first.draft_key());
        assert_eq!(first.paths().scope(), &scope);
        assert!(first
            .paths()
            .draft_database()
            .starts_with(root.reliability_root()));
        assert!(first
            .paths()
            .command_database()
            .starts_with(root.reliability_root()));
        drop(hierarchy);

        let second = ReliabilityKeyManager::initialize(&root, &vault)
            .unwrap()
            .activate_scope(scope)
            .unwrap();
        assert_eq!(first.context().kek_id(), second.context().kek_id());
        assert_eq!(
            first.context().install_epoch(),
            second.context().install_epoch()
        );
        assert_eq!(first.command_key(), second.command_key());
        assert_eq!(first.draft_key(), second.draft_key());
    }

    #[test]
    fn exact_scopes_never_share_derived_keys() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let hierarchy = ReliabilityKeyManager::initialize(&root, &vault).unwrap();
        let first = hierarchy
            .activate_scope(ExactScope::new("station-a", "ptid-a").unwrap())
            .unwrap();
        let second = hierarchy
            .activate_scope(ExactScope::new("station-a", "ptid-b").unwrap())
            .unwrap();
        assert_ne!(first.draft_key(), second.draft_key());
        assert_ne!(first.command_key(), second.command_key());
    }

    #[test]
    fn wrong_install_key_fails_closed_for_wrapped_scope_key() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let scope = ExactScope::new("station-a", "ptid-a").unwrap();
        ReliabilityKeyManager::initialize(&root, &vault)
            .unwrap()
            .activate_scope(scope.clone())
            .unwrap();

        let mut records = vault.records.lock().unwrap();
        let install = records.get_mut(INSTALL_KEK_RECORD_ID).unwrap();
        *install.last_mut().unwrap() ^= 0x5a;
        drop(records);

        let error = ReliabilityKeyManager::initialize(&root, &vault)
            .unwrap()
            .activate_scope(scope)
            .err()
            .unwrap();
        assert_eq!(error.kind(), ReliabilityErrorKind::AuthenticationFailed);
    }

    #[test]
    fn wrapped_scope_key_cannot_be_rebound_to_another_scope() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let scope_a = ExactScope::new("station-a", "ptid-a").unwrap();
        let scope_b = ExactScope::new("station-a", "ptid-b").unwrap();
        let manager = ReliabilityKeyManager::initialize(&root, &vault).unwrap();
        manager.activate_scope(scope_a.clone()).unwrap();
        manager.activate_scope(scope_b.clone()).unwrap();

        let record_a = scope_record_id(&scope_a);
        let record_b = scope_record_id(&scope_b);
        let mut records = vault.records.lock().unwrap();
        let wrapped_a = records.get(&record_a).unwrap().clone();
        let wrapped_b = records.get(&record_b).unwrap().clone();
        records.insert(record_a, wrapped_b);
        records.insert(record_b, wrapped_a);
        drop(records);

        let error = manager.activate_scope(scope_a).err().unwrap();
        assert_eq!(error.kind(), ReliabilityErrorKind::AuthenticationFailed);
    }

    #[test]
    fn mismatched_epoch_blocks_when_ciphertext_exists() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        ReliabilityKeyManager::initialize(&root, &vault).unwrap();
        fs::create_dir_all(root.v2_root()).unwrap();
        fs::write(root.v2_root().join("ciphertext"), b"opaque").unwrap();

        let mut epoch_record = Encoder::new(b"PTRE");
        epoch_record.u16(INSTALL_RECORD_VERSION);
        epoch_record.fixed(&[0x44; INSTALL_EPOCH_BYTES]);
        atomic_write(&root.install_epoch_path(), &epoch_record.finish()).unwrap();

        let error = ReliabilityKeyManager::initialize(&root, &vault)
            .err()
            .unwrap();
        assert_eq!(error.kind(), ReliabilityErrorKind::EpochMismatch);
    }

    #[test]
    fn surviving_orphan_key_is_rotated_without_ciphertext() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        let scope = ExactScope::new("station-a", "ptid-a").unwrap();
        ReliabilityKeyManager::initialize(&root, &vault)
            .unwrap()
            .activate_scope(scope.clone())
            .unwrap();
        let original = vault
            .records
            .lock()
            .unwrap()
            .get(INSTALL_KEK_RECORD_ID)
            .unwrap()
            .clone();
        fs::remove_dir_all(root.reliability_root()).unwrap();

        let reinstalled_root =
            CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        ReliabilityKeyManager::initialize(&reinstalled_root, &vault)
            .unwrap()
            .activate_scope(scope)
            .unwrap();
        let replacement = vault
            .records
            .lock()
            .unwrap()
            .get(INSTALL_KEK_RECORD_ID)
            .unwrap()
            .clone();
        assert_ne!(original, replacement);
    }

    #[test]
    fn missing_install_key_and_epoch_fail_closed_with_ciphertext() {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        fs::create_dir_all(root.v2_root()).unwrap();
        fs::write(root.v2_root().join("ciphertext"), b"opaque").unwrap();

        let error = ReliabilityKeyManager::initialize(&root, &vault)
            .err()
            .unwrap();

        assert_eq!(error.kind(), ReliabilityErrorKind::KeyUnavailable);
    }
}
