use crate::proto::chat::{
    ChatStorageError, ChatStorageErrorCode, ChatStorageOperation, ChatStorageOperationKind,
    ChatStorageOperationState, ChatStorageScope,
};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use ulid::Ulid;

pub const CACHE_SCOPE_KIND: &str = "cache";
const CLEANUP_QUARANTINE_PREFIX: &str = ".pt-cleanup-";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatStorageClass {
    RegenerableThumbnail,
    RedownloadableMedia,
    MessageProjection,
    Draft,
    Reliability,
    Crypto,
    ActiveTransfer,
    ExportedFile,
}

impl ChatStorageClass {
    pub fn is_cache_cleanup_candidate(self) -> bool {
        matches!(self, Self::RegenerableThumbnail | Self::RedownloadableMedia)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheCleanupItemState {
    Pending,
    Deleted,
    SkippedProtected,
    FailedRetryable,
    FailedTerminal,
}

impl CacheCleanupItemState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Deleted => "deleted",
            Self::SkippedProtected => "skipped_protected",
            Self::FailedRetryable => "failed_retryable",
            Self::FailedTerminal => "failed_terminal",
        }
    }

    pub fn from_str(value: &str) -> Result<Self, CacheCleanupError> {
        match value {
            "pending" => Ok(Self::Pending),
            "deleted" => Ok(Self::Deleted),
            "skipped_protected" => Ok(Self::SkippedProtected),
            "failed_retryable" => Ok(Self::FailedRetryable),
            "failed_terminal" => Ok(Self::FailedTerminal),
            _ => Err(CacheCleanupError::Journal(format!(
                "unknown cache cleanup item state: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheCleanupItem {
    pub item_id: String,
    pub target_ref: String,
    pub expected_size_bytes: u64,
    pub expected_digest: [u8; 32],
    pub state: CacheCleanupItemState,
    pub last_error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheCleanupOperation {
    pub operation_id: String,
    pub scope_revision: String,
    pub state: ChatStorageOperationState,
    pub estimated_reclaimable_bytes: u64,
    pub physical_bytes_before: u64,
    pub physical_bytes_after: Option<u64>,
    pub last_error_code: Option<String>,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone)]
pub struct CacheCleanupPlanInput {
    pub scope_revision: String,
    pub cache_roots: Vec<PathBuf>,
    pub protected_paths: Vec<PathBuf>,
    pub physical_bytes_before: u64,
    pub now_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheCleanupProgress {
    pub operation: CacheCleanupOperation,
    pub failed_item_count: usize,
    pub error: Option<CacheCleanupError>,
}

pub trait CacheCleanupJournalRepository {
    fn load_resumable_cache_cleanup(
        &self,
        scope_revision: &str,
    ) -> Result<Option<CacheCleanupOperation>, String>;

    fn create_cache_cleanup(
        &self,
        operation: &CacheCleanupOperation,
        items: &[CacheCleanupItem],
    ) -> Result<(), String>;

    fn load_cache_cleanup_items(&self, operation_id: &str)
        -> Result<Vec<CacheCleanupItem>, String>;

    fn update_cache_cleanup_item(
        &self,
        operation_id: &str,
        item_id: &str,
        state: CacheCleanupItemState,
        last_error_code: Option<&str>,
        updated_at_unix_ms: i64,
    ) -> Result<(), String>;

    fn update_cache_cleanup_operation(
        &self,
        operation_id: &str,
        state: ChatStorageOperationState,
        physical_bytes_after: Option<u64>,
        last_error_code: Option<&str>,
        updated_at_unix_ms: i64,
    ) -> Result<CacheCleanupOperation, String>;
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CacheCleanupError {
    #[error("chat cache cleanup scope is incomplete")]
    ScopeIncomplete,
    #[error("chat cache cleanup timestamp is invalid")]
    InvalidTimestamp,
    #[error("chat cache cleanup candidate is protected: {0}")]
    ProtectedCandidate(String),
    #[error("chat cache cleanup candidate changed: {0}")]
    CandidateChanged(String),
    #[error("chat cache cleanup I/O failed: {0}")]
    Io(String),
    #[error("chat cache cleanup physical reclamation is pending")]
    CompactionPending,
    #[error("chat cache cleanup journal failed: {0}")]
    Journal(String),
}

impl CacheCleanupError {
    pub fn code(&self) -> ChatStorageErrorCode {
        match self {
            Self::ScopeIncomplete => ChatStorageErrorCode::ScopeStale,
            Self::ProtectedCandidate(_) => ChatStorageErrorCode::ProtectedState,
            Self::CompactionPending => ChatStorageErrorCode::CompactionPending,
            Self::InvalidTimestamp | Self::CandidateChanged(_) | Self::Io(_) | Self::Journal(_) => {
                ChatStorageErrorCode::IoFailed
            }
        }
    }

    pub fn retryable(&self) -> bool {
        !matches!(self, Self::ScopeIncomplete | Self::CandidateChanged(_))
    }

    fn item_state(&self) -> CacheCleanupItemState {
        if self.retryable() {
            CacheCleanupItemState::FailedRetryable
        } else {
            CacheCleanupItemState::FailedTerminal
        }
    }
}

pub fn prepare_cache_cleanup<R: CacheCleanupJournalRepository>(
    repository: &R,
    input: CacheCleanupPlanInput,
) -> Result<CacheCleanupOperation, CacheCleanupError> {
    validate_plan_input(&input)?;
    if let Some(operation) = repository
        .load_resumable_cache_cleanup(&input.scope_revision)
        .map_err(CacheCleanupError::Journal)?
    {
        return Ok(operation);
    }

    let items = discover_cache_cleanup_items(&input.cache_roots, &input.protected_paths)?;
    let estimated_reclaimable_bytes = items.iter().fold(0_u64, |total, item| {
        total.saturating_add(item.expected_size_bytes)
    });
    let operation = CacheCleanupOperation {
        operation_id: Ulid::new().to_string(),
        scope_revision: input.scope_revision,
        state: ChatStorageOperationState::Planned,
        estimated_reclaimable_bytes,
        physical_bytes_before: input.physical_bytes_before,
        physical_bytes_after: None,
        last_error_code: None,
        created_at_unix_ms: input.now_unix_ms,
        updated_at_unix_ms: input.now_unix_ms,
    };
    repository
        .create_cache_cleanup(&operation, &items)
        .map_err(CacheCleanupError::Journal)?;
    Ok(operation)
}

pub fn execute_cache_cleanup<R: CacheCleanupJournalRepository>(
    repository: &R,
    operation: &CacheCleanupOperation,
    cache_roots: &[PathBuf],
    protected_paths: &[PathBuf],
    now_unix_ms: i64,
) -> Result<CacheCleanupProgress, CacheCleanupError> {
    if operation.scope_revision.trim().is_empty() {
        return Err(CacheCleanupError::ScopeIncomplete);
    }
    if now_unix_ms <= 0 {
        return Err(CacheCleanupError::InvalidTimestamp);
    }
    let items = repository
        .load_cache_cleanup_items(&operation.operation_id)
        .map_err(CacheCleanupError::Journal)?;
    let protected = normalize_paths(protected_paths);
    if let Some(item) = items.iter().find(|item| {
        matches!(
            item.state,
            CacheCleanupItemState::Pending | CacheCleanupItemState::FailedRetryable
        ) && protected.contains(&normalized_path(Path::new(&item.target_ref)))
    }) {
        let error = CacheCleanupError::ProtectedCandidate(item.target_ref.clone());
        let operation = repository
            .update_cache_cleanup_operation(
                &operation.operation_id,
                ChatStorageOperationState::FailedRetryable,
                operation.physical_bytes_after,
                Some(storage_error_code_name(error.code())),
                now_unix_ms,
            )
            .map_err(CacheCleanupError::Journal)?;
        return Ok(CacheCleanupProgress {
            operation,
            failed_item_count: 1,
            error: Some(error),
        });
    }

    repository
        .update_cache_cleanup_operation(
            &operation.operation_id,
            ChatStorageOperationState::DeletingFiles,
            operation.physical_bytes_after,
            None,
            now_unix_ms,
        )
        .map_err(CacheCleanupError::Journal)?;

    let roots = canonical_roots(cache_roots)?;
    let mut first_error = None;
    let mut failed_item_count = 0;
    let mut terminal_failure = false;
    for item in items {
        if !matches!(
            item.state,
            CacheCleanupItemState::Pending | CacheCleanupItemState::FailedRetryable
        ) {
            continue;
        }
        match delete_cache_item(&roots, &protected, &item) {
            Ok(()) => repository
                .update_cache_cleanup_item(
                    &operation.operation_id,
                    &item.item_id,
                    CacheCleanupItemState::Deleted,
                    None,
                    now_unix_ms,
                )
                .map_err(CacheCleanupError::Journal)?,
            Err(error) => {
                failed_item_count += 1;
                terminal_failure |= !error.retryable();
                repository
                    .update_cache_cleanup_item(
                        &operation.operation_id,
                        &item.item_id,
                        error.item_state(),
                        Some(storage_error_code_name(error.code())),
                        now_unix_ms,
                    )
                    .map_err(CacheCleanupError::Journal)?;
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    let state = if terminal_failure {
        ChatStorageOperationState::FailedTerminal
    } else if failed_item_count > 0 {
        ChatStorageOperationState::FailedRetryable
    } else {
        ChatStorageOperationState::Compacting
    };
    let operation = repository
        .update_cache_cleanup_operation(
            &operation.operation_id,
            state,
            operation.physical_bytes_after,
            first_error
                .as_ref()
                .map(|error| storage_error_code_name(error.code())),
            now_unix_ms,
        )
        .map_err(CacheCleanupError::Journal)?;
    Ok(CacheCleanupProgress {
        operation,
        failed_item_count,
        error: first_error,
    })
}

pub fn measure_cache_cleanup_remaining_bytes<R: CacheCleanupJournalRepository>(
    repository: &R,
    operation_id: &str,
    cache_roots: &[PathBuf],
) -> Result<u64, CacheCleanupError> {
    let roots = canonical_roots(cache_roots)?;
    let items = repository
        .load_cache_cleanup_items(operation_id)
        .map_err(CacheCleanupError::Journal)?;
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
            cleanup_quarantine_path(root, &target, &item)?,
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

pub fn finalize_cache_cleanup<R: CacheCleanupJournalRepository>(
    repository: &R,
    operation: &CacheCleanupOperation,
    physical_bytes_after: u64,
    now_unix_ms: i64,
) -> Result<CacheCleanupProgress, CacheCleanupError> {
    let items = repository
        .load_cache_cleanup_items(&operation.operation_id)
        .map_err(CacheCleanupError::Journal)?;
    let failed_item_count = items
        .iter()
        .filter(|item| {
            matches!(
                item.state,
                CacheCleanupItemState::FailedRetryable
                    | CacheCleanupItemState::FailedTerminal
                    | CacheCleanupItemState::SkippedProtected
            )
        })
        .count();
    if operation.state != ChatStorageOperationState::Compacting {
        return Ok(CacheCleanupProgress {
            operation: repository
                .update_cache_cleanup_operation(
                    &operation.operation_id,
                    operation.state,
                    Some(physical_bytes_after),
                    operation.last_error_code.as_deref(),
                    now_unix_ms,
                )
                .map_err(CacheCleanupError::Journal)?,
            failed_item_count,
            error: None,
        });
    }

    let reclaimed = operation
        .physical_bytes_before
        .saturating_sub(physical_bytes_after);
    let terminal_item_failure = items.iter().any(|item| {
        matches!(
            item.state,
            CacheCleanupItemState::FailedTerminal | CacheCleanupItemState::SkippedProtected
        )
    });
    let retryable_item_failure = items
        .iter()
        .any(|item| item.state == CacheCleanupItemState::FailedRetryable);
    let (state, error) = if terminal_item_failure {
        (
            ChatStorageOperationState::FailedTerminal,
            Some(CacheCleanupError::Io(
                "one or more cleanup targets could not be captured or deleted".to_string(),
            )),
        )
    } else if retryable_item_failure {
        (
            ChatStorageOperationState::FailedRetryable,
            Some(CacheCleanupError::Io(
                "one or more cleanup targets remain pending".to_string(),
            )),
        )
    } else if operation.estimated_reclaimable_bytes > 0 && reclaimed == 0 {
        (
            ChatStorageOperationState::CompactionPending,
            Some(CacheCleanupError::CompactionPending),
        )
    } else {
        (ChatStorageOperationState::Succeeded, None)
    };
    let operation = repository
        .update_cache_cleanup_operation(
            &operation.operation_id,
            state,
            Some(physical_bytes_after),
            error
                .as_ref()
                .map(|error| storage_error_code_name(error.code())),
            now_unix_ms,
        )
        .map_err(CacheCleanupError::Journal)?;
    Ok(CacheCleanupProgress {
        operation,
        failed_item_count,
        error,
    })
}

pub fn cache_cleanup_operation_proto(
    scope: ChatStorageScope,
    operation: &CacheCleanupOperation,
) -> ChatStorageOperation {
    ChatStorageOperation {
        operation_id: operation.operation_id.clone(),
        scope: Some(scope),
        scope_revision: operation.scope_revision.clone(),
        kind: ChatStorageOperationKind::ClearCache as i32,
        state: operation.state as i32,
        conversation_id: String::new(),
        estimated_reclaimable_bytes: operation.estimated_reclaimable_bytes,
        physical_bytes_before: operation.physical_bytes_before,
        physical_bytes_after: operation.physical_bytes_after.unwrap_or(0),
        created_at_unix_ms: operation.created_at_unix_ms,
        updated_at_unix_ms: operation.updated_at_unix_ms,
    }
}

pub fn cache_cleanup_error_proto(error: &CacheCleanupError) -> ChatStorageError {
    ChatStorageError {
        code: error.code() as i32,
        message: error.to_string(),
        retryable: error.retryable(),
    }
}

pub fn storage_operation_state_name(state: ChatStorageOperationState) -> &'static str {
    match state {
        ChatStorageOperationState::Unspecified => "unspecified",
        ChatStorageOperationState::Planned => "planned",
        ChatStorageOperationState::DeletingRows => "deleting_rows",
        ChatStorageOperationState::DeletingFiles => "deleting_files",
        ChatStorageOperationState::Compacting => "compacting",
        ChatStorageOperationState::CompactionPending => "compaction_pending",
        ChatStorageOperationState::PausedScopeInactive => "paused_scope_inactive",
        ChatStorageOperationState::Succeeded => "succeeded",
        ChatStorageOperationState::FailedRetryable => "failed_retryable",
        ChatStorageOperationState::FailedTerminal => "failed_terminal",
        ChatStorageOperationState::Cancelled => "cancelled",
    }
}

pub fn parse_storage_operation_state(
    value: &str,
) -> Result<ChatStorageOperationState, CacheCleanupError> {
    match value {
        "planned" => Ok(ChatStorageOperationState::Planned),
        "deleting_rows" => Ok(ChatStorageOperationState::DeletingRows),
        "deleting_files" => Ok(ChatStorageOperationState::DeletingFiles),
        "compacting" => Ok(ChatStorageOperationState::Compacting),
        "compaction_pending" => Ok(ChatStorageOperationState::CompactionPending),
        "paused_scope_inactive" => Ok(ChatStorageOperationState::PausedScopeInactive),
        "succeeded" => Ok(ChatStorageOperationState::Succeeded),
        "failed_retryable" => Ok(ChatStorageOperationState::FailedRetryable),
        "failed_terminal" => Ok(ChatStorageOperationState::FailedTerminal),
        "cancelled" => Ok(ChatStorageOperationState::Cancelled),
        _ => Err(CacheCleanupError::Journal(format!(
            "unknown cache cleanup operation state: {value}"
        ))),
    }
}

pub fn storage_error_code_name(code: ChatStorageErrorCode) -> &'static str {
    match code {
        ChatStorageErrorCode::Unspecified => "STORAGE_UNSPECIFIED",
        ChatStorageErrorCode::ScopeStale => "STORAGE_SCOPE_STALE",
        ChatStorageErrorCode::Busy => "STORAGE_BUSY",
        ChatStorageErrorCode::ProtectedState => "STORAGE_PROTECTED_STATE",
        ChatStorageErrorCode::IoFailed => "STORAGE_IO_FAILED",
        ChatStorageErrorCode::CompactionPending => "STORAGE_COMPACTION_PENDING",
        ChatStorageErrorCode::MeasurementPartial => "STORAGE_MEASUREMENT_PARTIAL",
        ChatStorageErrorCode::InvalidPolicy => "STORAGE_INVALID_POLICY",
    }
}

fn validate_plan_input(input: &CacheCleanupPlanInput) -> Result<(), CacheCleanupError> {
    if input.scope_revision.trim().is_empty() || input.cache_roots.is_empty() {
        return Err(CacheCleanupError::ScopeIncomplete);
    }
    if input.now_unix_ms <= 0 {
        return Err(CacheCleanupError::InvalidTimestamp);
    }
    Ok(())
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

pub fn failed_file_cleanup_item(path: &Path, error_code: &str) -> CacheCleanupItem {
    let mut identity = Sha256::new();
    identity.update(b"peers-touch:failed-cache-cleanup-target:v1");
    identity.update(path.to_string_lossy().as_bytes());
    CacheCleanupItem {
        item_id: hex::encode(identity.finalize()),
        target_ref: path.to_string_lossy().into_owned(),
        expected_size_bytes: 0,
        expected_digest: [0; 32],
        state: CacheCleanupItemState::FailedTerminal,
        last_error_code: Some(error_code.to_string()),
    }
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
    if quarantine.exists() {
        return Err(CacheCleanupError::Io(
            "chat cache cleanup quarantine path is occupied".to_string(),
        ));
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
    use std::collections::HashMap;
    use std::io::Write;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryJournal {
        operation: Mutex<Option<CacheCleanupOperation>>,
        items: Mutex<HashMap<String, CacheCleanupItem>>,
    }

    impl CacheCleanupJournalRepository for MemoryJournal {
        fn load_resumable_cache_cleanup(
            &self,
            scope_revision: &str,
        ) -> Result<Option<CacheCleanupOperation>, String> {
            Ok(self
                .operation
                .lock()
                .map_err(|_| "operation lock".to_string())?
                .clone()
                .filter(|operation| {
                    operation.scope_revision == scope_revision
                        && !matches!(
                            operation.state,
                            ChatStorageOperationState::Succeeded
                                | ChatStorageOperationState::FailedTerminal
                                | ChatStorageOperationState::Cancelled
                        )
                }))
        }

        fn create_cache_cleanup(
            &self,
            operation: &CacheCleanupOperation,
            items: &[CacheCleanupItem],
        ) -> Result<(), String> {
            *self
                .operation
                .lock()
                .map_err(|_| "operation lock".to_string())? = Some(operation.clone());
            *self.items.lock().map_err(|_| "items lock".to_string())? = items
                .iter()
                .cloned()
                .map(|item| (item.item_id.clone(), item))
                .collect();
            Ok(())
        }

        fn load_cache_cleanup_items(
            &self,
            _operation_id: &str,
        ) -> Result<Vec<CacheCleanupItem>, String> {
            Ok(self
                .items
                .lock()
                .map_err(|_| "items lock".to_string())?
                .values()
                .cloned()
                .collect())
        }

        fn update_cache_cleanup_item(
            &self,
            _operation_id: &str,
            item_id: &str,
            state: CacheCleanupItemState,
            last_error_code: Option<&str>,
            _updated_at_unix_ms: i64,
        ) -> Result<(), String> {
            let mut items = self.items.lock().map_err(|_| "items lock".to_string())?;
            let item = items
                .get_mut(item_id)
                .ok_or_else(|| "item missing".to_string())?;
            item.state = state;
            item.last_error_code = last_error_code.map(str::to_string);
            Ok(())
        }

        fn update_cache_cleanup_operation(
            &self,
            operation_id: &str,
            state: ChatStorageOperationState,
            physical_bytes_after: Option<u64>,
            last_error_code: Option<&str>,
            updated_at_unix_ms: i64,
        ) -> Result<CacheCleanupOperation, String> {
            let mut operation = self
                .operation
                .lock()
                .map_err(|_| "operation lock".to_string())?;
            let operation = operation
                .as_mut()
                .filter(|operation| operation.operation_id == operation_id)
                .ok_or_else(|| "operation missing".to_string())?;
            operation.state = state;
            operation.physical_bytes_after = physical_bytes_after;
            operation.last_error_code = last_error_code.map(str::to_string);
            operation.updated_at_unix_ms = updated_at_unix_ms;
            Ok(operation.clone())
        }
    }

    fn root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("peers-touch-cache-{name}-{}", Ulid::new()))
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let mut file = File::create(path).expect("create file");
        file.write_all(bytes).expect("write file");
    }

    #[test]
    fn cache_cleanup_preserves_protected_files_and_reports_physical_release() {
        let root = root("protected");
        let removable = root.join("removable.bin");
        let protected = root.join("active.part");
        write(&removable, &[7; 64]);
        write(&protected, &[8; 32]);
        let journal = MemoryJournal::default();
        let operation = prepare_cache_cleanup(
            &journal,
            CacheCleanupPlanInput {
                scope_revision: "scope-1".to_string(),
                cache_roots: vec![root.clone()],
                protected_paths: vec![protected.clone()],
                physical_bytes_before: 96,
                now_unix_ms: 1,
            },
        )
        .expect("prepare");
        assert_eq!(operation.estimated_reclaimable_bytes, 64);

        let progress = execute_cache_cleanup(
            &journal,
            &operation,
            std::slice::from_ref(&root),
            std::slice::from_ref(&protected),
            2,
        )
        .expect("execute");
        assert_eq!(
            progress.operation.state,
            ChatStorageOperationState::Compacting
        );
        assert!(!removable.exists());
        assert!(protected.exists());
        let completed =
            finalize_cache_cleanup(&journal, &progress.operation, 32, 3).expect("finish");
        assert_eq!(
            completed.operation.state,
            ChatStorageOperationState::Succeeded
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn interrupted_cleanup_reuses_immutable_items_without_expanding_candidates() {
        let root = root("resume");
        let first = root.join("first.bin");
        write(&first, &[1; 32]);
        let journal = MemoryJournal::default();
        let operation = prepare_cache_cleanup(
            &journal,
            CacheCleanupPlanInput {
                scope_revision: "scope-2".to_string(),
                cache_roots: vec![root.clone()],
                protected_paths: vec![],
                physical_bytes_before: 32,
                now_unix_ms: 1,
            },
        )
        .expect("prepare");
        write(&root.join("created-after-confirmation.bin"), &[2; 48]);

        let resumed = prepare_cache_cleanup(
            &journal,
            CacheCleanupPlanInput {
                scope_revision: "scope-2".to_string(),
                cache_roots: vec![root.clone()],
                protected_paths: vec![],
                physical_bytes_before: 80,
                now_unix_ms: 2,
            },
        )
        .expect("resume");
        assert_eq!(resumed.operation_id, operation.operation_id);
        let progress =
            execute_cache_cleanup(&journal, &resumed, std::slice::from_ref(&root), &[], 3)
                .expect("execute");

        assert!(!first.exists());
        assert!(root.join("created-after-confirmation.bin").exists());
        assert_eq!(
            progress.operation.state,
            ChatStorageOperationState::Compacting
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn cleanup_resumes_from_the_exact_quarantined_file_after_a_crash() {
        let root = root("quarantine-resume");
        let candidate = root.join("candidate.bin");
        write(&candidate, &[4; 24]);
        let journal = MemoryJournal::default();
        let operation = prepare_cache_cleanup(
            &journal,
            CacheCleanupPlanInput {
                scope_revision: "scope-quarantine".to_string(),
                cache_roots: vec![root.clone()],
                protected_paths: vec![],
                physical_bytes_before: 24,
                now_unix_ms: 1,
            },
        )
        .expect("prepare");
        let item = journal
            .load_cache_cleanup_items(&operation.operation_id)
            .expect("items")
            .pop()
            .expect("candidate");
        let canonical_root = fs::canonicalize(&root).expect("canonical root");
        let quarantine =
            cleanup_quarantine_path(&canonical_root, Path::new(&item.target_ref), &item)
                .expect("quarantine path");
        fs::create_dir_all(quarantine.parent().expect("quarantine parent"))
            .expect("create quarantine");
        fs::rename(&candidate, &quarantine).expect("simulate crash after quarantine");
        assert_eq!(
            measure_cache_cleanup_remaining_bytes(
                &journal,
                &operation.operation_id,
                std::slice::from_ref(&root),
            )
            .expect("measure quarantined target"),
            24
        );

        let progress =
            execute_cache_cleanup(&journal, &operation, std::slice::from_ref(&root), &[], 2)
                .expect("resume");

        assert_eq!(
            progress.operation.state,
            ChatStorageOperationState::Compacting
        );
        assert!(!candidate.exists());
        assert!(!quarantine.exists());
        let physical_bytes_after = measure_cache_cleanup_remaining_bytes(
            &journal,
            &operation.operation_id,
            std::slice::from_ref(&root),
        )
        .expect("measure deleted target");
        assert_eq!(physical_bytes_after, 0);
        let completed =
            finalize_cache_cleanup(&journal, &progress.operation, physical_bytes_after, 3)
                .expect("finalize measured cleanup");
        assert_eq!(
            completed.operation.state,
            ChatStorageOperationState::Succeeded
        );
        assert_eq!(completed.operation.physical_bytes_after, Some(0));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn compaction_preserves_terminal_capture_failure_in_the_final_result() {
        let journal = MemoryJournal::default();
        let operation = CacheCleanupOperation {
            operation_id: "terminal-redaction".to_string(),
            scope_revision: "scope-terminal-redaction".to_string(),
            state: ChatStorageOperationState::Compacting,
            estimated_reclaimable_bytes: 8,
            physical_bytes_before: 32,
            physical_bytes_after: None,
            last_error_code: Some("CHAT_STORAGE_ERROR_CODE_IO_FAILED".to_string()),
            created_at_unix_ms: 1,
            updated_at_unix_ms: 1,
        };
        let item = failed_file_cleanup_item(
            Path::new("/unavailable/redaction-target"),
            "CHAT_STORAGE_ERROR_CODE_IO_FAILED",
        );
        journal
            .create_cache_cleanup(&operation, &[item])
            .expect("journal terminal item");

        let progress =
            finalize_cache_cleanup(&journal, &operation, 16, 2).expect("finalize after compaction");

        assert_eq!(
            progress.operation.state,
            ChatStorageOperationState::FailedTerminal
        );
        assert_eq!(progress.failed_item_count, 1);
        assert!(progress.error.is_some());
        assert_eq!(progress.operation.physical_bytes_after, Some(16));
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_rejects_a_symlinked_quarantine_directory() {
        use std::os::unix::fs::symlink;

        let cache_root = root("quarantine-symlink");
        let outside = root("quarantine-outside");
        let candidate = cache_root.join("candidate.bin");
        write(&candidate, &[5; 24]);
        fs::create_dir_all(&outside).expect("create outside");
        let journal = MemoryJournal::default();
        let operation = prepare_cache_cleanup(
            &journal,
            CacheCleanupPlanInput {
                scope_revision: "scope-quarantine-symlink".to_string(),
                cache_roots: vec![cache_root.clone()],
                protected_paths: vec![],
                physical_bytes_before: 24,
                now_unix_ms: 1,
            },
        )
        .expect("prepare");
        let item = journal
            .load_cache_cleanup_items(&operation.operation_id)
            .expect("items")
            .pop()
            .expect("candidate");
        let canonical_root = fs::canonicalize(&cache_root).expect("canonical root");
        let quarantine =
            cleanup_quarantine_path(&canonical_root, Path::new(&item.target_ref), &item)
                .expect("quarantine path");
        symlink(&outside, quarantine.parent().expect("quarantine parent"))
            .expect("install quarantine symlink");

        let progress = execute_cache_cleanup(
            &journal,
            &operation,
            std::slice::from_ref(&cache_root),
            &[],
            2,
        )
        .expect("closed failure");

        assert_eq!(
            progress.operation.state,
            ChatStorageOperationState::FailedTerminal
        );
        assert!(matches!(
            progress.error,
            Some(CacheCleanupError::CandidateChanged(_))
        ));
        assert!(candidate.is_file());
        assert!(!outside.join("payload").exists());
        fs::remove_file(quarantine.parent().expect("quarantine parent")).expect("remove symlink");
        fs::remove_dir_all(cache_root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_rejects_an_intermediate_directory_replaced_by_a_symlink() {
        use std::os::unix::fs::symlink;

        let cache_root = root("intermediate-symlink");
        let original_parent = cache_root.join("nested");
        let retained_parent = cache_root.join("retained-nested");
        let outside = root("intermediate-outside");
        let candidate = original_parent.join("candidate.bin");
        write(&candidate, &[6; 24]);
        let journal = MemoryJournal::default();
        let operation = prepare_cache_cleanup(
            &journal,
            CacheCleanupPlanInput {
                scope_revision: "scope-intermediate-symlink".to_string(),
                cache_roots: vec![cache_root.clone()],
                protected_paths: vec![],
                physical_bytes_before: 24,
                now_unix_ms: 1,
            },
        )
        .expect("prepare");
        fs::rename(&original_parent, &retained_parent).expect("retain original directory");
        fs::create_dir_all(&outside).expect("create outside");
        write(&outside.join("candidate.bin"), &[6; 24]);
        symlink(&outside, &original_parent).expect("replace intermediate directory");

        let progress = execute_cache_cleanup(
            &journal,
            &operation,
            std::slice::from_ref(&cache_root),
            &[],
            2,
        )
        .expect("closed failure");

        assert_eq!(
            progress.operation.state,
            ChatStorageOperationState::FailedTerminal
        );
        assert!(matches!(
            progress.error,
            Some(CacheCleanupError::CandidateChanged(_))
        ));
        assert!(retained_parent.join("candidate.bin").is_file());
        assert!(outside.join("candidate.bin").is_file());
        fs::remove_file(original_parent).expect("remove symlink");
        fs::remove_dir_all(cache_root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[cfg(unix)]
    #[test]
    fn remaining_bytes_count_hard_linked_targets_once() {
        let root = root("hard-link-measurement");
        let first = root.join("first.bin");
        let second = root.join("second.bin");
        write(&first, &[7; 32]);
        fs::hard_link(&first, &second).expect("create hard link");
        let journal = MemoryJournal::default();
        let operation = prepare_cache_cleanup(
            &journal,
            CacheCleanupPlanInput {
                scope_revision: "scope-hard-link".to_string(),
                cache_roots: vec![root.clone()],
                protected_paths: vec![],
                physical_bytes_before: 32,
                now_unix_ms: 1,
            },
        )
        .expect("prepare");

        assert_eq!(
            measure_cache_cleanup_remaining_bytes(
                &journal,
                &operation.operation_id,
                std::slice::from_ref(&root),
            )
            .expect("measure"),
            32
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn candidate_that_becomes_protected_aborts_before_deletion() {
        let root = root("late-protected");
        let candidate = root.join("candidate.bin");
        write(&candidate, &[3; 16]);
        let journal = MemoryJournal::default();
        let operation = prepare_cache_cleanup(
            &journal,
            CacheCleanupPlanInput {
                scope_revision: "scope-3".to_string(),
                cache_roots: vec![root.clone()],
                protected_paths: vec![],
                physical_bytes_before: 16,
                now_unix_ms: 1,
            },
        )
        .expect("prepare");

        let progress = execute_cache_cleanup(
            &journal,
            &operation,
            std::slice::from_ref(&root),
            std::slice::from_ref(&candidate),
            2,
        )
        .expect("protected result");
        assert_eq!(
            progress.operation.state,
            ChatStorageOperationState::FailedRetryable
        );
        assert!(candidate.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn storage_classes_only_allow_regenerable_cache() {
        assert!(ChatStorageClass::RegenerableThumbnail.is_cache_cleanup_candidate());
        assert!(ChatStorageClass::RedownloadableMedia.is_cache_cleanup_candidate());
        for protected in [
            ChatStorageClass::MessageProjection,
            ChatStorageClass::Draft,
            ChatStorageClass::Reliability,
            ChatStorageClass::Crypto,
            ChatStorageClass::ActiveTransfer,
            ChatStorageClass::ExportedFile,
        ] {
            assert!(!protected.is_cache_cleanup_candidate());
        }
    }
}
