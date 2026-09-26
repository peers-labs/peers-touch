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

pub fn finalize_cache_cleanup<R: CacheCleanupJournalRepository>(
    repository: &R,
    operation: &CacheCleanupOperation,
    physical_bytes_after: u64,
    now_unix_ms: i64,
) -> Result<CacheCleanupProgress, CacheCleanupError> {
    if operation.state != ChatStorageOperationState::Compacting {
        let failed_item_count = repository
            .load_cache_cleanup_items(&operation.operation_id)
            .map_err(CacheCleanupError::Journal)?
            .into_iter()
            .filter(|item| {
                matches!(
                    item.state,
                    CacheCleanupItemState::FailedRetryable
                        | CacheCleanupItemState::FailedTerminal
                        | CacheCleanupItemState::SkippedProtected
                )
            })
            .count();
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
    let (state, error) = if operation.estimated_reclaimable_bytes > 0 && reclaimed == 0 {
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
        failed_item_count: 0,
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

fn delete_cache_item(
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
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
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
    if metadata.len() != item.expected_size_bytes
        || digest_file(&canonical)? != item.expected_digest
    {
        return Err(CacheCleanupError::CandidateChanged(item.target_ref.clone()));
    }
    fs::remove_file(&canonical).map_err(|error| CacheCleanupError::Io(error.to_string()))
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
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
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
