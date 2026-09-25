use std::fs;
use std::path::Path;

use super::cleanup::LogicalCleanupResult;
use super::codec::{
    atomic_write, read_file, reject_symlink, remove_regular_file_if_exists, sync_directory,
    Decoder, Encoder,
};
use super::error::{ReliabilityError, ReliabilityResult};
use super::key_vault::{KeyVault, INSTALL_KEK_RECORD_ID, SCOPE_DEK_RECORD_PREFIX};
use super::root::CanonicalReliabilityRoot;

const RESET_VERSION: u16 = 1;
const MAX_RESET_JOURNAL_BYTES: usize = 64 * 1024;
const MAX_SCOPE_KEY_RECORDS: usize = 4096;

pub trait ReliabilityStoreCloser {
    fn close_reliability_stores(&self) -> ReliabilityResult<()>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReliabilityResetStatus {
    Ready,
    RecoveryRequired { durable_phase: &'static str },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResetPhase {
    Started = 1,
    ScopeKeysRemoved = 2,
    DataRemoved = 3,
    InstallKeyRemoved = 4,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResetJournal {
    phase: ResetPhase,
    scope_record_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ResetStep {
    JournalPrepared,
    ScopeKeyRemoved(String),
    PathRemoved(String),
    DataRemoved,
    InstallKeyDeleted,
    InstallKeyRemoved,
}

pub struct ReliabilityReset;

impl ReliabilityReset {
    pub fn status(root: &CanonicalReliabilityRoot) -> ReliabilityResult<ReliabilityResetStatus> {
        Ok(match load_journal(root)? {
            None => ReliabilityResetStatus::Ready,
            Some(journal) => ReliabilityResetStatus::RecoveryRequired {
                durable_phase: journal.phase.as_str(),
            },
        })
    }

    pub fn reset_all<V: KeyVault, C: ReliabilityStoreCloser>(
        root: &CanonicalReliabilityRoot,
        vault: &V,
        closer: &C,
    ) -> ReliabilityResult<LogicalCleanupResult> {
        Self::reset_with_observer(root, vault, closer, |_| Ok(()))
    }

    fn reset_with_observer<V: KeyVault, C: ReliabilityStoreCloser>(
        root: &CanonicalReliabilityRoot,
        vault: &V,
        closer: &C,
        mut observe: impl FnMut(ResetStep) -> ReliabilityResult<()>,
    ) -> ReliabilityResult<LogicalCleanupResult> {
        closer.close_reliability_stores()?;
        let mut journal = match load_journal(root)? {
            Some(journal) => journal,
            None => {
                let mut scope_record_ids = vault.list(SCOPE_DEK_RECORD_PREFIX)?;
                scope_record_ids.sort();
                scope_record_ids.dedup();
                if scope_record_ids.len() > MAX_SCOPE_KEY_RECORDS
                    || scope_record_ids
                        .iter()
                        .any(|record_id| !record_id.starts_with(SCOPE_DEK_RECORD_PREFIX))
                {
                    return Err(ReliabilityError::corrupt(
                        "KeyVault returned an invalid scope-key inventory",
                    ));
                }
                let journal = ResetJournal {
                    phase: ResetPhase::Started,
                    scope_record_ids,
                };
                persist_journal(root, &journal)?;
                observe(ResetStep::JournalPrepared)?;
                journal
            }
        };

        if journal.phase == ResetPhase::Started {
            for record_id in &journal.scope_record_ids {
                vault.delete(record_id)?;
                observe(ResetStep::ScopeKeyRemoved(record_id.clone()))?;
            }
            journal.phase = ResetPhase::ScopeKeysRemoved;
            persist_journal(root, &journal)?;
        }

        if journal.phase == ResetPhase::ScopeKeysRemoved {
            remove_owned_reliability_data(root, &mut observe)?;
            journal.phase = ResetPhase::DataRemoved;
            persist_journal(root, &journal)?;
            observe(ResetStep::DataRemoved)?;
        }

        if journal.phase == ResetPhase::DataRemoved {
            vault.delete(INSTALL_KEK_RECORD_ID)?;
            observe(ResetStep::InstallKeyDeleted)?;
            journal.phase = ResetPhase::InstallKeyRemoved;
            persist_journal(root, &journal)?;
            observe(ResetStep::InstallKeyRemoved)?;
        }

        let keys_absent = vault.load(INSTALL_KEK_RECORD_ID)?.is_none()
            && vault.list(SCOPE_DEK_RECORD_PREFIX)?.is_empty();
        let paths_absent = reset_paths_absent(root)?;
        if !keys_absent || !paths_absent {
            return Err(ReliabilityError::new(
                super::error::ReliabilityErrorKind::ResetIncomplete,
                "reset journal remains because logical cleanup is incomplete",
            ));
        }
        remove_regular_file_if_exists(&root.reset_journal_path())?;
        Ok(LogicalCleanupResult::logical(
            true,
            paths_absent,
            keys_absent,
        ))
    }
}

impl ResetPhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::ScopeKeysRemoved => "scope_keys_removed",
            Self::DataRemoved => "data_removed",
            Self::InstallKeyRemoved => "install_key_removed",
        }
    }
}

fn remove_owned_reliability_data(
    root: &CanonicalReliabilityRoot,
    observe: &mut impl FnMut(ResetStep) -> ReliabilityResult<()>,
) -> ReliabilityResult<()> {
    for path in [root.v2_root(), root.legacy_archive_root()] {
        remove_owned_tree_if_exists(&path)?;
        observe(ResetStep::PathRemoved(path.display().to_string()))?;
    }
    for path in [root.legacy_manifest_path(), root.install_epoch_path()] {
        remove_regular_file_if_exists(&path)?;
        observe(ResetStep::PathRemoved(path.display().to_string()))?;
    }
    for path in root.legacy_paths() {
        remove_regular_file_if_exists(&path)?;
        observe(ResetStep::PathRemoved(path.display().to_string()))?;
    }
    Ok(())
}

fn remove_owned_tree_if_exists(path: &Path) -> ReliabilityResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(ReliabilityError::corrupt(format!(
                    "refusing to recursively remove non-directory owned path: {}",
                    path.display()
                )));
            }
            reject_symlink(path)?;
            fs::remove_dir_all(path)
                .map_err(|error| ReliabilityError::io("remove owned reliability tree", error))?;
            if let Some(parent) = path.parent() {
                sync_directory(parent)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ReliabilityError::io(
            "inspect owned reliability tree",
            error,
        )),
    }
}

fn reset_paths_absent(root: &CanonicalReliabilityRoot) -> ReliabilityResult<bool> {
    let mut paths = vec![
        root.v2_root(),
        root.legacy_archive_root(),
        root.legacy_manifest_path(),
        root.install_epoch_path(),
    ];
    paths.extend(root.legacy_paths());
    for path in paths {
        match fs::symlink_metadata(path) {
            Ok(_) => return Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ReliabilityError::io("verify reliability reset path", error));
            }
        }
    }
    Ok(true)
}

fn persist_journal(
    root: &CanonicalReliabilityRoot,
    journal: &ResetJournal,
) -> ReliabilityResult<()> {
    let mut encoder = Encoder::new(b"PTRJ");
    encoder.u16(RESET_VERSION);
    encoder.u8(journal.phase as u8);
    encoder.u32(
        u32::try_from(journal.scope_record_ids.len())
            .map_err(|_| ReliabilityError::corrupt("too many scope records in reset journal"))?,
    );
    for record_id in &journal.scope_record_ids {
        encoder.string(record_id)?;
    }
    atomic_write(&root.reset_journal_path(), &encoder.finish())
}

fn load_journal(root: &CanonicalReliabilityRoot) -> ReliabilityResult<Option<ResetJournal>> {
    let path = root.reset_journal_path();
    match fs::symlink_metadata(&path) {
        Ok(_) => {
            let bytes = read_file(&path, MAX_RESET_JOURNAL_BYTES)?;
            let mut decoder = Decoder::new(&bytes, b"PTRJ")?;
            if decoder.u16()? != RESET_VERSION {
                return Err(ReliabilityError::corrupt(
                    "unsupported reliability reset journal",
                ));
            }
            let phase = match decoder.u8()? {
                1 => ResetPhase::Started,
                2 => ResetPhase::ScopeKeysRemoved,
                3 => ResetPhase::DataRemoved,
                4 => ResetPhase::InstallKeyRemoved,
                _ => return Err(ReliabilityError::corrupt("invalid reset journal phase")),
            };
            let count = usize::try_from(decoder.u32()?)
                .map_err(|_| ReliabilityError::corrupt("invalid reset record count"))?;
            if count > MAX_SCOPE_KEY_RECORDS {
                return Err(ReliabilityError::corrupt(
                    "reset journal scope-key inventory exceeds limit",
                ));
            }
            let mut scope_record_ids = Vec::with_capacity(count);
            for _ in 0..count {
                let record_id = decoder.string(256)?;
                if !record_id.starts_with(SCOPE_DEK_RECORD_PREFIX) {
                    return Err(ReliabilityError::corrupt(
                        "reset journal contains an invalid KeyVault record",
                    ));
                }
                scope_record_ids.push(record_id);
            }
            decoder.finish()?;
            Ok(Some(ResetJournal {
                phase,
                scope_record_ids,
            }))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ReliabilityError::io("inspect reset journal", error)),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    use zeroize::Zeroizing;

    use super::super::{ExactScope, ReliabilityKeyManager};
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

    #[derive(Default)]
    struct Closer(AtomicUsize);

    impl ReliabilityStoreCloser for Closer {
        fn close_reliability_stores(&self) -> ReliabilityResult<()> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    struct TempAppData(PathBuf);

    impl TempAppData {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                "pt-reliability-reset-{}-{}",
                std::process::id(),
                ulid::Ulid::new()
            )))
        }
    }

    impl Drop for TempAppData {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn seeded_state() -> (TempAppData, CanonicalReliabilityRoot, MemoryVault, Closer) {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        let vault = MemoryVault::default();
        ReliabilityKeyManager::initialize(&root, &vault)
            .unwrap()
            .activate_scope(ExactScope::new("station-a", "ptid-a").unwrap())
            .unwrap();
        fs::create_dir_all(root.v2_root()).unwrap();
        fs::write(root.v2_root().join("ciphertext"), b"opaque").unwrap();
        fs::write(&root.legacy_paths()[0], b"legacy").unwrap();
        (app_data, root, vault, Closer::default())
    }

    #[test]
    fn reset_removes_fixed_data_and_keys_without_physical_deletion_claim() {
        let (_app_data, root, vault, closer) = seeded_state();
        let old_install = vault
            .records
            .lock()
            .unwrap()
            .get(INSTALL_KEK_RECORD_ID)
            .unwrap()
            .clone();
        let result = ReliabilityReset::reset_all(&root, &vault, &closer).unwrap();
        assert!(result.records_absent);
        assert!(result.paths_absent);
        assert!(result.keys_absent);
        assert!(!result.secure_physical_deletion_proven);
        assert_eq!(closer.0.load(Ordering::SeqCst), 1);
        assert!(!root.reset_journal_path().exists());
        assert_eq!(
            ReliabilityReset::status(&root).unwrap(),
            ReliabilityResetStatus::Ready
        );
        ReliabilityKeyManager::initialize(&root, &vault).unwrap();
        let new_install = vault
            .records
            .lock()
            .unwrap()
            .get(INSTALL_KEK_RECORD_ID)
            .unwrap()
            .clone();
        assert_ne!(old_install, new_install);
    }

    #[test]
    fn reset_journal_resumes_after_each_durable_step() {
        // Journal + one scope key + ten fixed path attempts + data phase +
        // install-key delete and committed phase. Each interruption must resume
        // idempotently.
        for crash_after in 1..=15 {
            let (_app_data, root, vault, closer) = seeded_state();
            let mut step = 0usize;
            let interrupted = ReliabilityReset::reset_with_observer(&root, &vault, &closer, |_| {
                step += 1;
                if step == crash_after {
                    Err(ReliabilityError::io("injected reset crash", "stop"))
                } else {
                    Ok(())
                }
            });
            if interrupted.is_err() {
                assert!(matches!(
                    ReliabilityReset::status(&root).unwrap(),
                    ReliabilityResetStatus::RecoveryRequired { .. }
                ));
                let recovered = ReliabilityReset::reset_all(&root, &vault, &closer).unwrap();
                assert!(recovered.paths_absent);
                assert!(recovered.keys_absent);
                assert!(!recovered.secure_physical_deletion_proven);
            }
        }
    }
}
