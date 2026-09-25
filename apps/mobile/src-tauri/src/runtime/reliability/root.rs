use std::fs;
use std::path::{Path, PathBuf};

use super::codec::{reject_symlink, sync_directory};
use super::error::{ReliabilityError, ReliabilityResult};
use super::scope::ExactScope;

const RELIABILITY_DIRECTORY: &str = "mobile-reliability";
const LEGACY_DATABASE_NAMES: [&str; 2] = ["command_ledger.db", "draft_store.db"];
const SQLITE_COMPANION_SUFFIXES: [&str; 3] = ["", "-wal", "-shm"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalReliabilityRoot {
    app_data_root: PathBuf,
    reliability_root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalScopePaths {
    scope: ExactScope,
    reliability_root: PathBuf,
    v2_root: PathBuf,
    scopes_root: PathBuf,
    scope_root: PathBuf,
    command_database: PathBuf,
    draft_database: PathBuf,
    draft_metadata: PathBuf,
}

impl CanonicalReliabilityRoot {
    /// Bind reliability storage to a trusted app-data directory supplied by Rust.
    ///
    /// This constructor never accepts a database path and never scans outside the
    /// fixed app-data children returned by this type.
    pub fn from_trusted_app_data(app_data_root: &Path) -> ReliabilityResult<Self> {
        if !app_data_root.is_absolute() {
            return Err(ReliabilityError::invalid(
                "trusted app-data root must be absolute",
            ));
        }
        fs::create_dir_all(app_data_root)
            .map_err(|error| ReliabilityError::io("create trusted app-data root", error))?;
        reject_symlink(app_data_root)?;
        let app_data_root = fs::canonicalize(app_data_root)
            .map_err(|error| ReliabilityError::io("canonicalize trusted app-data root", error))?;

        let reliability_candidate = app_data_root.join(RELIABILITY_DIRECTORY);
        match fs::symlink_metadata(&reliability_candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(ReliabilityError::corrupt(
                    "canonical reliability root is not a real directory",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&reliability_candidate).map_err(|error| {
                    ReliabilityError::io("create canonical reliability root", error)
                })?;
                sync_directory(&app_data_root)?;
            }
            Err(error) => {
                return Err(ReliabilityError::io(
                    "inspect canonical reliability root",
                    error,
                ));
            }
        }
        let reliability_root = fs::canonicalize(&reliability_candidate)
            .map_err(|error| ReliabilityError::io("canonicalize reliability root", error))?;
        if reliability_root.parent() != Some(app_data_root.as_path()) {
            return Err(ReliabilityError::corrupt(
                "canonical reliability root escaped trusted app-data",
            ));
        }

        Ok(Self {
            app_data_root,
            reliability_root,
        })
    }

    pub fn app_data_root(&self) -> &Path {
        &self.app_data_root
    }

    pub fn reliability_root(&self) -> &Path {
        &self.reliability_root
    }

    pub fn scope_paths(&self, scope: &ExactScope) -> CanonicalScopePaths {
        let v2_root = self.v2_root();
        let scopes_root = v2_root.join("scopes");
        let scope_root = scopes_root.join(scope.stable_token());
        CanonicalScopePaths {
            scope: scope.clone(),
            reliability_root: self.reliability_root.clone(),
            v2_root,
            scopes_root,
            command_database: scope_root.join("command_ledger.db"),
            draft_database: scope_root.join("draft_store.db"),
            draft_metadata: scope_root.join("draft_store.meta.v2"),
            scope_root,
        }
    }

    pub(crate) fn install_epoch_path(&self) -> PathBuf {
        self.reliability_root.join("install_epoch.v1")
    }

    pub(crate) fn legacy_manifest_path(&self) -> PathBuf {
        self.reliability_root.join("legacy_quarantine.v1")
    }

    pub(crate) fn legacy_archive_root(&self) -> PathBuf {
        self.reliability_root.join("legacy-v1")
    }

    pub(crate) fn reset_journal_path(&self) -> PathBuf {
        self.reliability_root.join("reset.v1")
    }

    pub(crate) fn v2_root(&self) -> PathBuf {
        self.reliability_root.join("v2")
    }

    pub(crate) fn draft_database_path(&self, scope: &ExactScope) -> PathBuf {
        self.scope_paths(scope).draft_database
    }

    pub(crate) fn draft_metadata_path(&self, scope: &ExactScope) -> PathBuf {
        self.scope_paths(scope).draft_metadata
    }

    pub(crate) fn command_database_path(&self, scope: &ExactScope) -> PathBuf {
        self.scope_paths(scope).command_database
    }

    pub(crate) fn legacy_paths(&self) -> Vec<PathBuf> {
        let mut paths =
            Vec::with_capacity(LEGACY_DATABASE_NAMES.len() * SQLITE_COMPANION_SUFFIXES.len());
        for database in LEGACY_DATABASE_NAMES {
            for suffix in SQLITE_COMPANION_SUFFIXES {
                paths.push(self.app_data_root.join(format!("{database}{suffix}")));
            }
        }
        paths
    }

    pub(crate) fn has_any_ciphertext(&self) -> ReliabilityResult<bool> {
        if self.fixed_path_exists(&self.v2_root())?
            || self.fixed_path_exists(&self.legacy_archive_root())?
            || self.fixed_path_exists(&self.legacy_manifest_path())?
        {
            return Ok(true);
        }
        for path in self.legacy_paths() {
            if self.fixed_path_exists(&path)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(crate) fn has_scope_ciphertext(&self, scope: &ExactScope) -> ReliabilityResult<bool> {
        for path in [
            self.draft_database_path(scope),
            self.draft_metadata_path(scope),
            self.command_database_path(scope),
        ] {
            if self.fixed_path_exists(&path)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn fixed_path_exists(&self, path: &Path) -> ReliabilityResult<bool> {
        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(ReliabilityError::corrupt(format!(
                        "owned reliability path is a symlink: {}",
                        path.display()
                    )));
                }
                Ok(true)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(ReliabilityError::io(
                "inspect owned reliability path",
                error,
            )),
        }
    }
}

impl CanonicalScopePaths {
    pub fn scope(&self) -> &ExactScope {
        &self.scope
    }

    pub fn reliability_root(&self) -> &Path {
        &self.reliability_root
    }

    pub fn v2_root(&self) -> &Path {
        &self.v2_root
    }

    pub fn scopes_root(&self) -> &Path {
        &self.scopes_root
    }

    pub fn scope_root(&self) -> &Path {
        &self.scope_root
    }

    pub fn command_database(&self) -> &Path {
        &self.command_database
    }

    pub fn draft_database(&self) -> &Path {
        &self.draft_database
    }

    pub fn draft_metadata(&self) -> &Path {
        &self.draft_metadata
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_app_data() -> PathBuf {
        std::env::temp_dir().join(format!(
            "pt-reliability-root-{}-{}",
            std::process::id(),
            ulid::Ulid::new()
        ))
    }

    #[test]
    fn root_exposes_only_fixed_legacy_candidates() {
        let app_data = temporary_app_data();
        let root = CanonicalReliabilityRoot::from_trusted_app_data(&app_data).unwrap();
        let legacy = root.legacy_paths();
        assert_eq!(legacy.len(), 6);
        assert!(legacy
            .iter()
            .all(|path| path.parent() == Some(root.app_data_root())));
        assert!(legacy
            .iter()
            .any(|path| path.ends_with("command_ledger.db")));
        assert!(legacy
            .iter()
            .any(|path| path.ends_with("draft_store.db-shm")));
        fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn root_rejects_relative_input() {
        assert!(CanonicalReliabilityRoot::from_trusted_app_data(Path::new("relative")).is_err());
    }
}
