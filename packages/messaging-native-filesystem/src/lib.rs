use messaging_core::proto::chat::{ChatStorageErrorCode, ChatStorageMeasurementIssue};
use messaging_core::storage_governance::cache::{
    CacheCleanupError, CacheCleanupFilesystem, CacheCleanupItem, CacheCleanupItemState,
};
use messaging_core::storage_governance::{
    PhysicalStorageFile, PhysicalStorageMeasurement, PhysicalStoragePath, StorageMeasurementPort,
};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

const CLEANUP_QUARANTINE_PREFIX: &str = ".pt-cleanup-";

#[derive(Debug, Clone, Copy, Default)]
pub struct NativeMessagingFilesystem;

pub fn path_ref(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}

pub fn path_refs(paths: &[PathBuf]) -> Vec<String> {
    paths.iter().map(path_ref).collect()
}

impl StorageMeasurementPort for NativeMessagingFilesystem {
    fn measure(&self, paths: &[PhysicalStoragePath]) -> Result<PhysicalStorageMeasurement, String> {
        Ok(measure_physical_storage(paths))
    }
}

impl CacheCleanupFilesystem for NativeMessagingFilesystem {
    fn discover(
        &self,
        cache_roots: &[String],
        protected_paths: &[String],
    ) -> Result<Vec<CacheCleanupItem>, CacheCleanupError> {
        discover_cache_cleanup_items(
            &decode_path_refs(cache_roots),
            &decode_path_refs(protected_paths),
        )
    }

    fn protected_target(
        &self,
        items: &[CacheCleanupItem],
        protected_paths: &[String],
    ) -> Result<Option<String>, CacheCleanupError> {
        let protected = normalize_paths(&decode_path_refs(protected_paths));
        Ok(items
            .iter()
            .find(|item| protected.contains(&normalized_path(Path::new(&item.target_ref))))
            .map(|item| item.target_ref.clone()))
    }

    fn delete(
        &self,
        cache_roots: &[String],
        protected_paths: &[String],
        item: &CacheCleanupItem,
    ) -> Result<(), CacheCleanupError> {
        let roots = canonical_roots(&decode_path_refs(cache_roots))?;
        let protected = normalize_paths(&decode_path_refs(protected_paths));
        delete_cache_item(&roots, &protected, item)
    }

    fn remaining_bytes(
        &self,
        items: &[CacheCleanupItem],
        cache_roots: &[String],
    ) -> Result<u64, CacheCleanupError> {
        measure_remaining_bytes(items, &decode_path_refs(cache_roots))
    }
}

pub fn immutable_file_cleanup_item(
    path: &Path,
) -> Result<Option<CacheCleanupItem>, CacheCleanupError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(CacheCleanupError::Io(error.to_string())),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CacheCleanupError::CandidateChanged(
            path.to_string_lossy().to_string(),
        ));
    }
    let path = normalized_path(path);
    let expected_digest = digest_file(&path)?;
    let expected_size_bytes = metadata.len();
    Ok(Some(CacheCleanupItem {
        item_id: cache_item_id(&path, expected_size_bytes, &expected_digest),
        target_ref: path.to_string_lossy().to_string(),
        expected_size_bytes,
        expected_digest,
        state: CacheCleanupItemState::Pending,
        last_error_code: None,
    }))
}

pub fn cleanup_file_physical_identity(path: &Path) -> Result<Option<String>, CacheCleanupError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(CacheCleanupError::Io(error.to_string())),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CacheCleanupError::CandidateChanged(
            path.to_string_lossy().into_owned(),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(Some(format!("unix:{}:{}", metadata.dev(), metadata.ino())))
    }
    #[cfg(not(unix))]
    {
        fs::canonicalize(path)
            .map(|path| Some(format!("path:{}", path.display())))
            .map_err(|error| CacheCleanupError::Io(error.to_string()))
    }
}

fn measure_physical_storage(paths: &[PhysicalStoragePath]) -> PhysicalStorageMeasurement {
    let mut files = Vec::new();
    let mut issues = Vec::new();
    for entry in paths {
        collect_path(entry, &mut files, &mut issues);
    }
    PhysicalStorageMeasurement { files, issues }
}

fn collect_path(
    entry: &PhysicalStoragePath,
    files: &mut Vec<PhysicalStorageFile>,
    issues: &mut Vec<ChatStorageMeasurementIssue>,
) {
    let path = Path::new(&entry.path_ref);
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if !entry.required && error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            issues.push(measurement_issue(entry, error.to_string()));
            return;
        }
    };
    if metadata.file_type().is_symlink() {
        issues.push(measurement_issue(
            entry,
            "symbolic links are outside the managed storage boundary".to_string(),
        ));
        return;
    }
    if metadata.is_file() {
        count_file(path, &metadata, entry, files, issues);
        return;
    }
    if !metadata.is_dir() {
        return;
    }

    let mut pending = vec![path.to_path_buf()];
    let mut visited_directories = HashSet::new();
    while let Some(directory) = pending.pop() {
        let canonical = match fs::canonicalize(&directory) {
            Ok(path) => path,
            Err(error) => {
                issues.push(measurement_issue(entry, error.to_string()));
                continue;
            }
        };
        if !visited_directories.insert(canonical) {
            continue;
        }
        let children = match fs::read_dir(&directory) {
            Ok(children) => children,
            Err(error) => {
                issues.push(measurement_issue(entry, error.to_string()));
                continue;
            }
        };
        for child in children {
            let child = match child {
                Ok(child) => child,
                Err(error) => {
                    issues.push(measurement_issue(entry, error.to_string()));
                    continue;
                }
            };
            let path = child.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    issues.push(measurement_issue(entry, error.to_string()));
                    continue;
                }
            };
            if metadata.file_type().is_symlink() {
                issues.push(measurement_issue(
                    entry,
                    "symbolic links are outside the managed storage boundary".to_string(),
                ));
            } else if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() {
                count_file(&path, &metadata, entry, files, issues);
            }
        }
    }
}

fn count_file(
    path: &Path,
    metadata: &fs::Metadata,
    entry: &PhysicalStoragePath,
    files: &mut Vec<PhysicalStorageFile>,
    issues: &mut Vec<ChatStorageMeasurementIssue>,
) {
    match file_identity(path, metadata) {
        Ok(physical_identity) => files.push(PhysicalStorageFile {
            physical_identity,
            bytes: metadata.len(),
            class: entry.class,
        }),
        Err(error) => issues.push(measurement_issue(entry, error.to_string())),
    }
}

#[cfg(unix)]
fn file_identity(_path: &Path, metadata: &fs::Metadata) -> std::io::Result<String> {
    use std::os::unix::fs::MetadataExt;
    Ok(format!("unix:{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn file_identity(path: &Path, _metadata: &fs::Metadata) -> std::io::Result<String> {
    fs::canonicalize(path).map(|path| format!("path:{}", path.display()))
}

fn measurement_issue(entry: &PhysicalStoragePath, detail: String) -> ChatStorageMeasurementIssue {
    ChatStorageMeasurementIssue {
        code: ChatStorageErrorCode::MeasurementPartial as i32,
        source: entry.class.source().to_string(),
        detail,
    }
}

fn discover_cache_cleanup_items(
    cache_roots: &[PathBuf],
    protected_paths: &[PathBuf],
) -> Result<Vec<CacheCleanupItem>, CacheCleanupError> {
    let protected = normalize_paths(protected_paths);
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for root in cache_roots {
        let metadata = match fs::symlink_metadata(root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(CacheCleanupError::Io(error.to_string())),
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CacheCleanupError::Io(format!(
                "cache root is not a managed directory: {}",
                root.display()
            )));
        }
        let canonical_root =
            fs::canonicalize(root).map_err(|error| CacheCleanupError::Io(error.to_string()))?;
        let mut pending = vec![canonical_root];
        while let Some(directory) = pending.pop() {
            for child in fs::read_dir(&directory)
                .map_err(|error| CacheCleanupError::Io(error.to_string()))?
            {
                let child = child.map_err(|error| CacheCleanupError::Io(error.to_string()))?;
                let path = child.path();
                let metadata = fs::symlink_metadata(&path)
                    .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
                if metadata.file_type().is_symlink() {
                    return Err(CacheCleanupError::Io(format!(
                        "symbolic links are outside the managed cache boundary: {}",
                        path.display()
                    )));
                }
                if metadata.is_dir() {
                    if path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.starts_with(CLEANUP_QUARANTINE_PREFIX))
                    {
                        continue;
                    }
                    pending.push(path);
                    continue;
                }
                if !metadata.is_file() {
                    continue;
                }
                let path = normalized_path(&path);
                if protected.contains(&path) || !seen.insert(path.clone()) {
                    continue;
                }
                let expected_digest = digest_file(&path)?;
                let expected_size_bytes = metadata.len();
                items.push(CacheCleanupItem {
                    item_id: cache_item_id(&path, expected_size_bytes, &expected_digest),
                    target_ref: path.to_string_lossy().to_string(),
                    expected_size_bytes,
                    expected_digest,
                    state: CacheCleanupItemState::Pending,
                    last_error_code: None,
                });
            }
        }
    }
    items.sort_by(|left, right| left.target_ref.cmp(&right.target_ref));
    Ok(items)
}

fn measure_remaining_bytes(
    items: &[CacheCleanupItem],
    cache_roots: &[PathBuf],
) -> Result<u64, CacheCleanupError> {
    let roots = canonical_roots(cache_roots)?;
    let mut total = 0_u64;
    let mut seen = HashSet::new();
    for item in items {
        if matches!(
            item.state,
            CacheCleanupItemState::FailedTerminal | CacheCleanupItemState::SkippedProtected
        ) {
            continue;
        }
        let target = PathBuf::from(&item.target_ref);
        let root = cleanup_root(&roots, &target)?;
        for path in [
            target.clone(),
            cleanup_quarantine_path(root, &target, item)?,
        ] {
            match immutable_file_cleanup_item(&path) {
                Ok(Some(current))
                    if current.expected_size_bytes == item.expected_size_bytes
                        && current.expected_digest == item.expected_digest =>
                {
                    if let Some(identity) = cleanup_file_physical_identity(&path)? {
                        if seen.insert(identity) {
                            total = total.saturating_add(current.expected_size_bytes);
                        }
                    }
                }
                Ok(Some(_)) | Ok(None) | Err(CacheCleanupError::CandidateChanged(_)) => {}
                Err(error) => return Err(error),
            }
        }
    }
    Ok(total)
}

fn delete_cache_item(
    roots: &[PathBuf],
    protected: &HashSet<PathBuf>,
    item: &CacheCleanupItem,
) -> Result<(), CacheCleanupError> {
    #[cfg(unix)]
    {
        delete_cache_item_unix(roots, protected, item)
    }
    #[cfg(not(unix))]
    {
        delete_cache_item_portable(roots, protected, item)
    }
}

#[cfg(unix)]
fn delete_cache_item_unix(
    roots: &[PathBuf],
    protected: &HashSet<PathBuf>,
    item: &CacheCleanupItem,
) -> Result<(), CacheCleanupError> {
    use rustix::fs::{
        mkdirat, openat, renameat_with, unlinkat, AtFlags, Mode, OFlags, RenameFlags,
    };

    let path = PathBuf::from(&item.target_ref);
    if protected.contains(&normalized_path(&path)) {
        return Err(CacheCleanupError::ProtectedCandidate(
            item.target_ref.clone(),
        ));
    }
    let root = cleanup_root(roots, &path)?;
    let (parent_fd, file_name) = open_managed_parent(root, &path, item)?;
    let quarantine_name = cleanup_quarantine_directory_name(item)?;
    let directory_flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let quarantine_fd = match openat(
        &parent_fd,
        quarantine_name.as_str(),
        directory_flags,
        Mode::empty(),
    ) {
        Ok(fd) => fd,
        Err(rustix::io::Errno::NOENT) => {
            mkdirat(
                &parent_fd,
                quarantine_name.as_str(),
                Mode::RUSR | Mode::WUSR | Mode::XUSR,
            )
            .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
            openat(
                &parent_fd,
                quarantine_name.as_str(),
                directory_flags,
                Mode::empty(),
            )
            .map_err(|error| CacheCleanupError::Io(error.to_string()))?
        }
        Err(_) => return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone())),
    };
    let file_flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC;

    match openat(&quarantine_fd, "payload", file_flags, Mode::empty()) {
        Ok(file) => {
            validate_cleanup_item_file_handle(File::from(file), item)?;
            unlinkat(&quarantine_fd, "payload", AtFlags::empty())
                .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
            unlinkat(&parent_fd, quarantine_name.as_str(), AtFlags::REMOVEDIR)
                .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
            return Ok(());
        }
        Err(rustix::io::Errno::NOENT) => {}
        Err(_) => return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone())),
    }

    match renameat_with(
        &parent_fd,
        &file_name,
        &quarantine_fd,
        "payload",
        RenameFlags::NOREPLACE,
    ) {
        Ok(()) => {}
        Err(rustix::io::Errno::NOENT) => {
            unlinkat(&parent_fd, quarantine_name.as_str(), AtFlags::REMOVEDIR)
                .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
            return Ok(());
        }
        Err(error) => return Err(CacheCleanupError::Io(error.to_string())),
    }
    let file = openat(&quarantine_fd, "payload", file_flags, Mode::empty())
        .map_err(|_| CacheCleanupError::CandidateChanged(item.target_ref.clone()))?;
    if let Err(error) = validate_cleanup_item_file_handle(File::from(file), item) {
        let _ = renameat_with(
            &quarantine_fd,
            "payload",
            &parent_fd,
            &file_name,
            RenameFlags::NOREPLACE,
        );
        return Err(error);
    }
    unlinkat(&quarantine_fd, "payload", AtFlags::empty())
        .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
    unlinkat(&parent_fd, quarantine_name.as_str(), AtFlags::REMOVEDIR)
        .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
    Ok(())
}

#[cfg(unix)]
fn open_managed_parent(
    root: &Path,
    target: &Path,
    item: &CacheCleanupItem,
) -> Result<(rustix::fd::OwnedFd, std::ffi::OsString), CacheCleanupError> {
    use rustix::fs::{open, openat, Mode, OFlags};
    use std::path::Component;

    let relative = target
        .strip_prefix(root)
        .map_err(|_| CacheCleanupError::CandidateChanged(item.target_ref.clone()))?;
    let file_name = relative
        .file_name()
        .ok_or_else(|| CacheCleanupError::CandidateChanged(item.target_ref.clone()))?
        .to_os_string();
    let directory_flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let mut directory = open("/", directory_flags, Mode::empty())
        .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
    for component in root.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(name) => {
                directory = openat(&directory, name, directory_flags, Mode::empty())
                    .map_err(|_| CacheCleanupError::CandidateChanged(item.target_ref.clone()))?;
            }
            _ => return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone())),
        }
    }
    if let Some(parent) = relative.parent() {
        for component in parent.components() {
            let Component::Normal(name) = component else {
                return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone()));
            };
            directory = openat(&directory, name, directory_flags, Mode::empty())
                .map_err(|_| CacheCleanupError::CandidateChanged(item.target_ref.clone()))?;
        }
    }
    Ok((directory, file_name))
}

#[cfg(not(unix))]
fn delete_cache_item_portable(
    roots: &[PathBuf],
    protected: &HashSet<PathBuf>,
    item: &CacheCleanupItem,
) -> Result<(), CacheCleanupError> {
    let path = PathBuf::from(&item.target_ref);
    if protected.contains(&normalized_path(&path)) {
        return Err(CacheCleanupError::ProtectedCandidate(
            item.target_ref.clone(),
        ));
    }
    let root = cleanup_root(roots, &path)?;
    let quarantine = cleanup_quarantine_path(root, &path, item)?;
    ensure_cleanup_quarantine_parent(root, &quarantine, item)?;
    if quarantine.exists() {
        validate_cleanup_item_file(&quarantine, item)?;
        fs::remove_file(&quarantine).map_err(|error| CacheCleanupError::Io(error.to_string()))?;
        remove_empty_quarantine_parent(&quarantine);
        return Ok(());
    }
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            remove_empty_quarantine_parent(&quarantine);
            return Ok(());
        }
        Err(error) => return Err(CacheCleanupError::Io(error.to_string())),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone()));
    }
    let canonical =
        fs::canonicalize(&path).map_err(|error| CacheCleanupError::Io(error.to_string()))?;
    if !roots.iter().any(|root| canonical.starts_with(root)) {
        return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone()));
    }
    fs::rename(&canonical, &quarantine)
        .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
    if let Err(error) = validate_cleanup_item_file(&quarantine, item) {
        if !path.exists() {
            fs::rename(&quarantine, &path)
                .map_err(|restore_error| CacheCleanupError::Io(restore_error.to_string()))?;
        }
        return Err(error);
    }
    fs::remove_file(&quarantine).map_err(|error| CacheCleanupError::Io(error.to_string()))?;
    remove_empty_quarantine_parent(&quarantine);
    Ok(())
}

fn cleanup_root<'a>(roots: &'a [PathBuf], path: &Path) -> Result<&'a PathBuf, CacheCleanupError> {
    roots
        .iter()
        .filter(|root| path.starts_with(root))
        .max_by_key(|root| root.components().count())
        .ok_or_else(|| CacheCleanupError::CandidateChanged(path.to_string_lossy().to_string()))
}

fn cleanup_quarantine_path(
    root: &Path,
    target: &Path,
    item: &CacheCleanupItem,
) -> Result<PathBuf, CacheCleanupError> {
    let parent = target
        .parent()
        .filter(|parent| parent.starts_with(root))
        .ok_or_else(|| CacheCleanupError::CandidateChanged(item.target_ref.clone()))?;
    Ok(parent
        .join(cleanup_quarantine_directory_name(item)?)
        .join("payload"))
}

fn cleanup_quarantine_directory_name(item: &CacheCleanupItem) -> Result<String, CacheCleanupError> {
    if item.item_id.is_empty() || !item.item_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone()));
    }
    Ok(format!(
        "{CLEANUP_QUARANTINE_PREFIX}{}",
        item.item_id.to_ascii_lowercase()
    ))
}

#[cfg(not(unix))]
fn ensure_cleanup_quarantine_parent(
    root: &Path,
    quarantine: &Path,
    item: &CacheCleanupItem,
) -> Result<(), CacheCleanupError> {
    let directory = quarantine
        .parent()
        .ok_or_else(|| CacheCleanupError::CandidateChanged(item.target_ref.clone()))?;
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(directory).map_err(|error| CacheCleanupError::Io(error.to_string()))?;
        }
        Err(error) => return Err(CacheCleanupError::Io(error.to_string())),
    }
    let canonical =
        fs::canonicalize(directory).map_err(|error| CacheCleanupError::Io(error.to_string()))?;
    if !canonical.starts_with(root) {
        return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone()));
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_cleanup_item_file(
    path: &Path,
    item: &CacheCleanupItem,
) -> Result<(), CacheCleanupError> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| CacheCleanupError::Io(error.to_string()))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() != item.expected_size_bytes
        || digest_file(path)? != item.expected_digest
    {
        return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone()));
    }
    Ok(())
}

#[cfg(unix)]
fn validate_cleanup_item_file_handle(
    mut file: File,
    item: &CacheCleanupItem,
) -> Result<(), CacheCleanupError> {
    let metadata = file
        .metadata()
        .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
    if !metadata.is_file()
        || metadata.len() != item.expected_size_bytes
        || digest_reader(&mut file)? != item.expected_digest
    {
        return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone()));
    }
    Ok(())
}

#[cfg(not(unix))]
fn remove_empty_quarantine_parent(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = fs::remove_dir(parent);
    }
}

fn canonical_roots(roots: &[PathBuf]) -> Result<Vec<PathBuf>, CacheCleanupError> {
    roots
        .iter()
        .filter(|root| root.exists())
        .map(|root| {
            fs::canonicalize(root).map_err(|error| CacheCleanupError::Io(error.to_string()))
        })
        .collect()
}

fn normalize_paths(paths: &[PathBuf]) -> HashSet<PathBuf> {
    paths.iter().map(|path| normalized_path(path)).collect()
}

fn normalized_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn decode_path_refs(paths: &[String]) -> Vec<PathBuf> {
    paths.iter().map(PathBuf::from).collect()
}

fn digest_file(path: &Path) -> Result<[u8; 32], CacheCleanupError> {
    let mut file = File::open(path).map_err(|error| CacheCleanupError::Io(error.to_string()))?;
    digest_reader(&mut file)
}

fn digest_reader(reader: &mut impl Read) -> Result<[u8; 32], CacheCleanupError> {
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| CacheCleanupError::Io(error.to_string()))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(digest.finalize().into())
}

fn cache_item_id(path: &Path, size: u64, digest: &[u8; 32]) -> String {
    let mut identity = Sha256::new();
    identity.update(path.to_string_lossy().as_bytes());
    identity.update(size.to_be_bytes());
    identity.update(digest);
    hex::encode(identity.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use messaging_core::storage_governance::{
        PhysicalStorageClass, PhysicalStoragePath, StorageMeasurementPort,
    };
    use std::io::Write;

    fn root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "peers-touch-native-fs-{name}-{}",
            ulid::Ulid::new()
        ))
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = File::create(path).unwrap();
        file.write_all(bytes).unwrap();
    }

    #[test]
    fn measurement_deduplicates_hard_links_by_physical_identity() {
        let root = root("measurement");
        let first = root.join("first");
        let second = root.join("second");
        write(&first, &[7; 32]);
        fs::hard_link(&first, &second).unwrap();

        let measurement = NativeMessagingFilesystem
            .measure(&[
                PhysicalStoragePath::required(first.to_string_lossy(), PhysicalStorageClass::Cache),
                PhysicalStoragePath::required(
                    second.to_string_lossy(),
                    PhysicalStorageClass::Protected,
                ),
            ])
            .unwrap();

        assert_eq!(measurement.files.len(), 2);
        assert_eq!(
            measurement.files[0].physical_identity,
            measurement.files[1].physical_identity
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_discovers_and_deletes_only_confirmed_files() {
        let root = root("cleanup");
        let candidate = root.join("candidate");
        let protected = root.join("protected");
        write(&candidate, &[1; 24]);
        write(&protected, &[2; 16]);
        let filesystem = NativeMessagingFilesystem;
        let roots = vec![root.to_string_lossy().into_owned()];
        let protected_refs = vec![protected.to_string_lossy().into_owned()];
        let items = filesystem.discover(&roots, &protected_refs).unwrap();

        assert_eq!(items.len(), 1);
        filesystem
            .delete(&roots, &protected_refs, &items[0])
            .unwrap();
        assert!(!candidate.exists());
        assert!(protected.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_rejects_an_intermediate_symlink_replacement() {
        use std::os::unix::fs::symlink;

        let cache_root = root("symlink");
        let original_parent = cache_root.join("nested");
        let retained_parent = cache_root.join("retained");
        let outside = root("outside");
        let candidate = original_parent.join("candidate");
        write(&candidate, &[3; 24]);
        let filesystem = NativeMessagingFilesystem;
        let roots = vec![cache_root.to_string_lossy().into_owned()];
        let items = filesystem.discover(&roots, &[]).unwrap();
        fs::rename(&original_parent, &retained_parent).unwrap();
        write(&outside.join("candidate"), &[3; 24]);
        symlink(&outside, &original_parent).unwrap();

        assert!(matches!(
            filesystem.delete(&roots, &[], &items[0]),
            Err(CacheCleanupError::CandidateChanged(_))
        ));
        assert!(retained_parent.join("candidate").exists());
        assert!(outside.join("candidate").exists());
        fs::remove_file(original_parent).unwrap();
        fs::remove_dir_all(cache_root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
