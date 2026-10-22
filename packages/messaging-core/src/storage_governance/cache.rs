use crate::proto::chat::{
    ChatStorageError, ChatStorageErrorCode, ChatStorageOperation, ChatStorageOperationKind,
    ChatStorageOperationState, ChatStorageScope,
};
use sha2::{Digest, Sha256};
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
    pub cache_roots: Vec<String>,
    pub protected_paths: Vec<String>,
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

pub trait CacheCleanupFilesystem: Send + Sync {
    fn discover(
        &self,
        cache_roots: &[String],
        protected_paths: &[String],
    ) -> Result<Vec<CacheCleanupItem>, CacheCleanupError>;

    fn protected_target(
        &self,
        items: &[CacheCleanupItem],
        protected_paths: &[String],
    ) -> Result<Option<String>, CacheCleanupError>;

    fn delete(
        &self,
        cache_roots: &[String],
        protected_paths: &[String],
        item: &CacheCleanupItem,
    ) -> Result<(), CacheCleanupError>;

    fn remaining_bytes(
        &self,
        items: &[CacheCleanupItem],
        cache_roots: &[String],
    ) -> Result<u64, CacheCleanupError>;
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
    filesystem: &dyn CacheCleanupFilesystem,
    input: CacheCleanupPlanInput,
) -> Result<CacheCleanupOperation, CacheCleanupError> {
    validate_plan_input(&input)?;
    if let Some(operation) = repository
        .load_resumable_cache_cleanup(&input.scope_revision)
        .map_err(CacheCleanupError::Journal)?
    {
        return Ok(operation);
    }

    let items = filesystem.discover(&input.cache_roots, &input.protected_paths)?;
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
    filesystem: &dyn CacheCleanupFilesystem,
    operation: &CacheCleanupOperation,
    cache_roots: &[String],
    protected_paths: &[String],
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
    let pending_items = items
        .iter()
        .filter(|item| {
            matches!(
                item.state,
                CacheCleanupItemState::Pending | CacheCleanupItemState::FailedRetryable
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    if let Some(target_ref) = filesystem.protected_target(&pending_items, protected_paths)? {
        let error = CacheCleanupError::ProtectedCandidate(target_ref);
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

    let mut first_error = None;
    let mut failed_item_count = 0;
    let mut terminal_failure = false;
    for item in pending_items {
        match filesystem.delete(cache_roots, protected_paths, &item) {
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
    filesystem: &dyn CacheCleanupFilesystem,
    operation_id: &str,
    cache_roots: &[String],
) -> Result<u64, CacheCleanupError> {
    let items = repository
        .load_cache_cleanup_items(operation_id)
        .map_err(CacheCleanupError::Journal)?;
    filesystem.remaining_bytes(&items, cache_roots)
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

pub fn failed_file_cleanup_item(target_ref: &str, error_code: &str) -> CacheCleanupItem {
    let mut identity = Sha256::new();
    identity.update(b"peers-touch:failed-cache-cleanup-target:v1");
    identity.update(target_ref.as_bytes());
    CacheCleanupItem {
        item_id: hex::encode(identity.finalize()),
        target_ref: target_ref.to_string(),
        expected_size_bytes: 0,
        expected_digest: [0; 32],
        state: CacheCleanupItemState::FailedTerminal,
        last_error_code: Some(error_code.to_string()),
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
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

    struct Filesystem;

    impl CacheCleanupFilesystem for Filesystem {
        fn discover(
            &self,
            _cache_roots: &[String],
            _protected_paths: &[String],
        ) -> Result<Vec<CacheCleanupItem>, CacheCleanupError> {
            Ok(vec![CacheCleanupItem {
                item_id: "a1".to_string(),
                target_ref: "/cache/a".to_string(),
                expected_size_bytes: 64,
                expected_digest: [7; 32],
                state: CacheCleanupItemState::Pending,
                last_error_code: None,
            }])
        }

        fn protected_target(
            &self,
            _items: &[CacheCleanupItem],
            protected_paths: &[String],
        ) -> Result<Option<String>, CacheCleanupError> {
            Ok(protected_paths.first().cloned())
        }

        fn delete(
            &self,
            _cache_roots: &[String],
            _protected_paths: &[String],
            _item: &CacheCleanupItem,
        ) -> Result<(), CacheCleanupError> {
            Ok(())
        }

        fn remaining_bytes(
            &self,
            items: &[CacheCleanupItem],
            _cache_roots: &[String],
        ) -> Result<u64, CacheCleanupError> {
            Ok(items
                .iter()
                .filter(|item| item.state != CacheCleanupItemState::Deleted)
                .map(|item| item.expected_size_bytes)
                .sum())
        }
    }

    #[test]
    fn cache_cleanup_journal_owns_policy_while_filesystem_executes_actions() {
        let journal = MemoryJournal::default();
        let operation = prepare_cache_cleanup(
            &journal,
            &Filesystem,
            CacheCleanupPlanInput {
                scope_revision: "scope-1".to_string(),
                cache_roots: vec!["/cache".to_string()],
                protected_paths: Vec::new(),
                physical_bytes_before: 64,
                now_unix_ms: 1,
            },
        )
        .unwrap();
        let progress = execute_cache_cleanup(
            &journal,
            &Filesystem,
            &operation,
            &["/cache".to_string()],
            &[],
            2,
        )
        .unwrap();

        assert_eq!(
            progress.operation.state,
            ChatStorageOperationState::Compacting
        );
        let completed = finalize_cache_cleanup(&journal, &progress.operation, 0, 3).unwrap();
        assert_eq!(
            completed.operation.state,
            ChatStorageOperationState::Succeeded
        );
    }

    #[test]
    fn late_protection_aborts_before_filesystem_deletion() {
        let journal = MemoryJournal::default();
        let operation = prepare_cache_cleanup(
            &journal,
            &Filesystem,
            CacheCleanupPlanInput {
                scope_revision: "scope-2".to_string(),
                cache_roots: vec!["/cache".to_string()],
                protected_paths: Vec::new(),
                physical_bytes_before: 64,
                now_unix_ms: 1,
            },
        )
        .unwrap();
        let progress = execute_cache_cleanup(
            &journal,
            &Filesystem,
            &operation,
            &["/cache".to_string()],
            &["/cache/a".to_string()],
            2,
        )
        .unwrap();

        assert_eq!(
            progress.operation.state,
            ChatStorageOperationState::FailedRetryable
        );
        assert!(matches!(
            progress.error,
            Some(CacheCleanupError::ProtectedCandidate(_))
        ));
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
