use std::fs;
use std::path::{Path, PathBuf};

use rand::{rngs::OsRng, RngCore};

use super::cleanup::LogicalCleanupResult;
use super::codec::{
    atomic_write, read_file, reject_symlink, remove_regular_file_if_exists, sync_directory,
    Decoder, Encoder,
};
use super::error::{ReliabilityError, ReliabilityResult};
use super::root::CanonicalReliabilityRoot;

const MANIFEST_VERSION: u16 = 1;
const MAX_MANIFEST_BYTES: usize = 1024;
const LEGACY_FILE_COUNT: usize = 6;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LegacyQuarantineState {
    Clean,
    DispositionRequired {
        archived_files: usize,
        command_admission_open: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyQuarantineAction {
    Retain,
    DiscardLegacy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LegacyQuarantineActionResult {
    Retained(LegacyQuarantineState),
    Discarded(LogicalCleanupResult),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ManifestPhase {
    Moving = 1,
    Complete = 2,
    Discarding = 3,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Manifest {
    phase: ManifestPhase,
    archive_id: String,
    present_mask: u8,
    moved_mask: u8,
    deleted_mask: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QuarantineStep {
    ManifestPrepared,
    FileRenamed(usize),
    FileRecorded(usize),
    CompleteRecorded,
    DiscardStarted,
    FileDeleted(usize),
}

pub struct LegacyQuarantine;

impl LegacyQuarantine {
    pub fn status(root: &CanonicalReliabilityRoot) -> ReliabilityResult<LegacyQuarantineState> {
        Self::recover(root)
    }

    pub fn recover(root: &CanonicalReliabilityRoot) -> ReliabilityResult<LegacyQuarantineState> {
        Self::recover_with_observer(root, |_| Ok(()))
    }

    pub fn apply(
        root: &CanonicalReliabilityRoot,
        action: LegacyQuarantineAction,
    ) -> ReliabilityResult<LegacyQuarantineActionResult> {
        match action {
            LegacyQuarantineAction::Retain => {
                Self::retain(root).map(LegacyQuarantineActionResult::Retained)
            }
            LegacyQuarantineAction::DiscardLegacy => {
                Self::discard_legacy(root).map(LegacyQuarantineActionResult::Discarded)
            }
        }
    }

    pub fn retain(root: &CanonicalReliabilityRoot) -> ReliabilityResult<LegacyQuarantineState> {
        Self::recover(root)
    }

    pub fn discard_legacy(
        root: &CanonicalReliabilityRoot,
    ) -> ReliabilityResult<LogicalCleanupResult> {
        let state = Self::recover(root)?;
        if state == LegacyQuarantineState::Clean {
            return Ok(LogicalCleanupResult::logical(true, true, true));
        }
        let mut manifest = load_manifest(root)?
            .ok_or_else(|| ReliabilityError::corrupt("legacy quarantine state has no manifest"))?;
        manifest.phase = ManifestPhase::Discarding;
        persist_manifest(root, &manifest)?;
        Self::discard_with_observer(root, manifest, |_| Ok(()))
    }

    fn recover_with_observer(
        root: &CanonicalReliabilityRoot,
        mut observe: impl FnMut(QuarantineStep) -> ReliabilityResult<()>,
    ) -> ReliabilityResult<LegacyQuarantineState> {
        let manifest = match load_manifest(root)? {
            Some(manifest) => manifest,
            None => match prepare_manifest(root)? {
                Some(manifest) => {
                    observe(QuarantineStep::ManifestPrepared)?;
                    manifest
                }
                None => return Ok(LegacyQuarantineState::Clean),
            },
        };

        match manifest.phase {
            ManifestPhase::Moving => {
                let manifest = move_files(root, manifest, &mut observe)?;
                Ok(disposition(&manifest))
            }
            ManifestPhase::Complete => {
                validate_complete(root, &manifest)?;
                Ok(disposition(&manifest))
            }
            ManifestPhase::Discarding => {
                Self::discard_with_observer(root, manifest, &mut observe)?;
                Ok(LegacyQuarantineState::Clean)
            }
        }
    }

    fn discard_with_observer(
        root: &CanonicalReliabilityRoot,
        mut manifest: Manifest,
        mut observe: impl FnMut(QuarantineStep) -> ReliabilityResult<()>,
    ) -> ReliabilityResult<LogicalCleanupResult> {
        if manifest.phase != ManifestPhase::Discarding {
            manifest.phase = ManifestPhase::Discarding;
            persist_manifest(root, &manifest)?;
        }
        observe(QuarantineStep::DiscardStarted)?;

        let archive = archive_directory(root, &manifest);
        for index in 0..LEGACY_FILE_COUNT {
            let bit = 1u8 << index;
            if manifest.present_mask & bit == 0 || manifest.deleted_mask & bit != 0 {
                continue;
            }
            let destination = archive.join(legacy_filename(root, index)?);
            remove_regular_file_if_exists(&destination)?;
            manifest.deleted_mask |= bit;
            persist_manifest(root, &manifest)?;
            observe(QuarantineStep::FileDeleted(index))?;
        }

        if archive.exists() {
            reject_symlink(&archive)?;
            fs::remove_dir(&archive)
                .map_err(|error| ReliabilityError::io("remove legacy archive directory", error))?;
            sync_directory(&root.legacy_archive_root())?;
        }
        let archive_root = root.legacy_archive_root();
        if archive_root.exists() {
            reject_symlink(&archive_root)?;
            fs::remove_dir(&archive_root)
                .map_err(|error| ReliabilityError::io("remove empty legacy archive root", error))?;
            sync_directory(root.reliability_root())?;
        }
        remove_regular_file_if_exists(&root.legacy_manifest_path())?;

        let paths_absent = root.legacy_paths().iter().all(|path| !path.exists())
            && !archive.exists()
            && !archive_root.exists()
            && !root.legacy_manifest_path().exists();
        Ok(LogicalCleanupResult::logical(true, paths_absent, true))
    }
}

fn prepare_manifest(root: &CanonicalReliabilityRoot) -> ReliabilityResult<Option<Manifest>> {
    let legacy_paths = root.legacy_paths();
    let mut present_mask = 0u8;
    for (index, path) in legacy_paths.iter().enumerate() {
        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(ReliabilityError::corrupt(format!(
                        "legacy database candidate is not a regular file: {}",
                        path.display()
                    )));
                }
                present_mask |= 1u8 << index;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ReliabilityError::io(
                    "inspect canonical legacy database",
                    error,
                ));
            }
        }
    }
    if present_mask == 0 {
        return Ok(None);
    }

    let manifest = Manifest {
        phase: ManifestPhase::Moving,
        archive_id: random_archive_id(),
        present_mask,
        moved_mask: 0,
        deleted_mask: 0,
    };
    persist_manifest(root, &manifest)?;
    Ok(Some(manifest))
}

fn move_files(
    root: &CanonicalReliabilityRoot,
    mut manifest: Manifest,
    observe: &mut impl FnMut(QuarantineStep) -> ReliabilityResult<()>,
) -> ReliabilityResult<Manifest> {
    let archive_root = root.legacy_archive_root();
    fs::create_dir_all(&archive_root)
        .map_err(|error| ReliabilityError::io("create legacy archive root", error))?;
    reject_symlink(&archive_root)?;
    let archive = archive_directory(root, &manifest);
    fs::create_dir_all(&archive)
        .map_err(|error| ReliabilityError::io("create legacy archive directory", error))?;
    reject_symlink(&archive)?;
    sync_directory(root.reliability_root())?;
    sync_directory(&archive_root)?;

    let legacy_paths = root.legacy_paths();
    for (index, source) in legacy_paths.iter().enumerate() {
        let bit = 1u8 << index;
        let destination = archive.join(legacy_filename(root, index)?);
        if manifest.present_mask & bit == 0 {
            if source.exists() || destination.exists() {
                return Err(ReliabilityError::corrupt(
                    "untracked legacy file appeared during quarantine",
                ));
            }
            continue;
        }

        let source_exists = regular_file_exists(source)?;
        let destination_exists = regular_file_exists(&destination)?;
        match (
            manifest.moved_mask & bit != 0,
            source_exists,
            destination_exists,
        ) {
            (true, false, true) => {}
            (false, true, false) => {
                fs::rename(source, &destination).map_err(|error| {
                    ReliabilityError::io("same-filesystem legacy quarantine rename", error)
                })?;
                sync_directory(root.app_data_root())?;
                sync_directory(&archive)?;
                observe(QuarantineStep::FileRenamed(index))?;
                manifest.moved_mask |= bit;
                persist_manifest(root, &manifest)?;
                observe(QuarantineStep::FileRecorded(index))?;
            }
            (false, false, true) => {
                // A crash can occur after rename and directory fsync but before
                // the moved bit reaches the manifest.
                sync_directory(root.app_data_root())?;
                sync_directory(&archive)?;
                manifest.moved_mask |= bit;
                persist_manifest(root, &manifest)?;
                observe(QuarantineStep::FileRecorded(index))?;
            }
            _ => {
                return Err(ReliabilityError::corrupt(format!(
                    "ambiguous legacy quarantine state for {}",
                    source.display()
                )));
            }
        }
    }

    if manifest.moved_mask != manifest.present_mask {
        return Err(ReliabilityError::corrupt(
            "legacy quarantine manifest did not account for every source file",
        ));
    }
    manifest.phase = ManifestPhase::Complete;
    persist_manifest(root, &manifest)?;
    observe(QuarantineStep::CompleteRecorded)?;
    validate_complete(root, &manifest)?;
    Ok(manifest)
}

fn validate_complete(
    root: &CanonicalReliabilityRoot,
    manifest: &Manifest,
) -> ReliabilityResult<()> {
    if manifest.phase != ManifestPhase::Complete || manifest.moved_mask != manifest.present_mask {
        return Err(ReliabilityError::corrupt(
            "legacy quarantine manifest is not complete",
        ));
    }
    let archive = archive_directory(root, manifest);
    for (index, source) in root.legacy_paths().iter().enumerate() {
        let bit = 1u8 << index;
        let destination = archive.join(legacy_filename(root, index)?);
        if source.exists() {
            return Err(ReliabilityError::corrupt(
                "legacy source remains after completed quarantine",
            ));
        }
        if manifest.present_mask & bit != 0 && !regular_file_exists(&destination)? {
            return Err(ReliabilityError::corrupt(
                "legacy archive file is missing after completed quarantine",
            ));
        }
        if manifest.present_mask & bit == 0 && destination.exists() {
            return Err(ReliabilityError::corrupt(
                "legacy archive contains an untracked file",
            ));
        }
    }
    Ok(())
}

fn disposition(manifest: &Manifest) -> LegacyQuarantineState {
    LegacyQuarantineState::DispositionRequired {
        archived_files: manifest.present_mask.count_ones() as usize,
        command_admission_open: false,
    }
}

fn persist_manifest(root: &CanonicalReliabilityRoot, manifest: &Manifest) -> ReliabilityResult<()> {
    let mut encoder = Encoder::new(b"PTLQ");
    encoder.u16(MANIFEST_VERSION);
    encoder.u8(manifest.phase as u8);
    encoder.u8(manifest.present_mask);
    encoder.u8(manifest.moved_mask);
    encoder.u8(manifest.deleted_mask);
    encoder.string(&manifest.archive_id)?;
    atomic_write(&root.legacy_manifest_path(), &encoder.finish())
}

fn load_manifest(root: &CanonicalReliabilityRoot) -> ReliabilityResult<Option<Manifest>> {
    let path = root.legacy_manifest_path();
    match fs::symlink_metadata(&path) {
        Ok(_) => {
            let bytes = read_file(&path, MAX_MANIFEST_BYTES)?;
            let mut decoder = Decoder::new(&bytes, b"PTLQ")?;
            if decoder.u16()? != MANIFEST_VERSION {
                return Err(ReliabilityError::corrupt(
                    "unsupported legacy quarantine manifest",
                ));
            }
            let phase = match decoder.u8()? {
                1 => ManifestPhase::Moving,
                2 => ManifestPhase::Complete,
                3 => ManifestPhase::Discarding,
                _ => {
                    return Err(ReliabilityError::corrupt("invalid legacy quarantine phase"));
                }
            };
            let present_mask = decoder.u8()?;
            let moved_mask = decoder.u8()?;
            let deleted_mask = decoder.u8()?;
            let archive_id = decoder.string(64)?;
            decoder.finish()?;
            if present_mask == 0
                || moved_mask & !present_mask != 0
                || deleted_mask & !present_mask != 0
                || !archive_id
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            {
                return Err(ReliabilityError::corrupt(
                    "invalid legacy quarantine manifest fields",
                ));
            }
            Ok(Some(Manifest {
                phase,
                archive_id,
                present_mask,
                moved_mask,
                deleted_mask,
            }))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ReliabilityError::io(
            "inspect legacy quarantine manifest",
            error,
        )),
    }
}

fn archive_directory(root: &CanonicalReliabilityRoot, manifest: &Manifest) -> PathBuf {
    root.legacy_archive_root().join(&manifest.archive_id)
}

fn legacy_filename(root: &CanonicalReliabilityRoot, index: usize) -> ReliabilityResult<String> {
    root.legacy_paths()
        .get(index)
        .and_then(|path| path.file_name())
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or_else(|| ReliabilityError::corrupt("legacy filename is unavailable"))
}

fn regular_file_exists(path: &Path) -> ReliabilityResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => Err(
            ReliabilityError::corrupt(format!("expected regular file: {}", path.display())),
        ),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(ReliabilityError::io("inspect quarantine file", error)),
    }
}

fn random_archive_id() -> String {
    let mut random = [0u8; 16];
    OsRng.fill_bytes(&mut random);
    let mut value = String::with_capacity(32);
    for byte in random {
        use std::fmt::Write;
        write!(&mut value, "{byte:02x}").expect("writing to String cannot fail");
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempAppData(PathBuf);

    impl TempAppData {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                "pt-legacy-quarantine-{}-{}",
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

    fn seeded_root() -> (TempAppData, CanonicalReliabilityRoot) {
        let app_data = TempAppData::new();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data.0).unwrap();
        for (index, path) in root.legacy_paths().iter().enumerate() {
            fs::write(path, format!("opaque-{index}")).unwrap();
        }
        (app_data, root)
    }

    #[test]
    fn quarantines_only_six_canonical_v1_files_and_retain_blocks_admission() {
        let (_app_data, root) = seeded_root();
        let arbitrary = root.app_data_root().join("web-selected/command_ledger.db");
        fs::create_dir_all(arbitrary.parent().unwrap()).unwrap();
        fs::write(&arbitrary, b"outside fixed legacy ownership").unwrap();

        let state = LegacyQuarantine::recover(&root).unwrap();
        assert_eq!(
            state,
            LegacyQuarantineState::DispositionRequired {
                archived_files: 6,
                command_admission_open: false
            }
        );
        assert!(arbitrary.exists());
        assert!(root.legacy_paths().iter().all(|path| !path.exists()));
        assert_eq!(LegacyQuarantine::retain(&root).unwrap(), state);
    }

    #[test]
    fn every_quarantine_step_recovers_after_injected_crash() {
        for crash_after in 1..=14 {
            let (_app_data, root) = seeded_root();
            let mut step = 0usize;
            let interrupted = LegacyQuarantine::recover_with_observer(&root, |_| {
                step += 1;
                if step == crash_after {
                    Err(ReliabilityError::io("injected crash", "stop"))
                } else {
                    Ok(())
                }
            });
            if interrupted.is_err() {
                let recovered = LegacyQuarantine::recover(&root).unwrap();
                assert!(matches!(
                    recovered,
                    LegacyQuarantineState::DispositionRequired {
                        archived_files: 6,
                        command_admission_open: false
                    }
                ));
            }
        }
    }

    #[test]
    fn ambiguous_source_and_destination_fail_closed() {
        let (_app_data, root) = seeded_root();
        let mut stopped = false;
        let _ = LegacyQuarantine::recover_with_observer(&root, |step| {
            if matches!(step, QuarantineStep::FileRenamed(0)) {
                stopped = true;
                return Err(ReliabilityError::io("injected crash", "stop"));
            }
            Ok(())
        });
        assert!(stopped);
        fs::write(&root.legacy_paths()[0], b"reappeared").unwrap();
        assert!(LegacyQuarantine::recover(&root).is_err());
    }

    #[test]
    fn discard_is_logical_and_never_claims_physical_deletion() {
        let (_app_data, root) = seeded_root();
        LegacyQuarantine::recover(&root).unwrap();
        let result =
            match LegacyQuarantine::apply(&root, LegacyQuarantineAction::DiscardLegacy).unwrap() {
                LegacyQuarantineActionResult::Discarded(result) => result,
                other => panic!("unexpected quarantine action result: {other:?}"),
            };
        assert!(result.paths_absent);
        assert!(result.records_absent);
        assert!(result.keys_absent);
        assert!(!result.secure_physical_deletion_proven);
        assert_eq!(
            LegacyQuarantine::recover(&root).unwrap(),
            LegacyQuarantineState::Clean
        );
    }
}
