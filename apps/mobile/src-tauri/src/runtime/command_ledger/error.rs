use std::fmt;
use std::io;

pub type LedgerResult<T> = Result<T, LedgerError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerCapacityExhaustionCause {
    RecordCount,
    ByteCapacity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerErrorCode {
    NotInitialized,
    AlreadyInitialized,
    InvalidConfiguration,
    InvalidEnvelope,
    InvalidScope,
    SchemaMismatch,
    KeyMetadataMismatch,
    AuthenticationFailed,
    CommandConflict,
    CommandNotFound,
    StateConflict,
    CapacityExceeded,
    PayloadTooLarge,
    InflightLimit,
    LegacyArchiveRetained,
    LegacyQuarantineIncomplete,
    Serialization,
    Crypto,
    Storage,
    Io,
}

#[derive(Debug)]
pub struct LedgerError {
    pub code: LedgerErrorCode,
    pub operation: &'static str,
    pub command_id: Option<String>,
    capacity_exhaustion_causes: Vec<LedgerCapacityExhaustionCause>,
    detail: String,
}

impl LedgerError {
    pub fn new(code: LedgerErrorCode, operation: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            operation,
            command_id: None,
            capacity_exhaustion_causes: Vec::new(),
            detail: detail.into(),
        }
    }

    pub fn for_command(
        code: LedgerErrorCode,
        operation: &'static str,
        command_id: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            code,
            operation,
            command_id: Some(command_id.into()),
            capacity_exhaustion_causes: Vec::new(),
            detail: detail.into(),
        }
    }

    pub fn capacity_exceeded(
        operation: &'static str,
        command_id: impl Into<String>,
        causes: Vec<LedgerCapacityExhaustionCause>,
        detail: impl Into<String>,
    ) -> Self {
        debug_assert!(!causes.is_empty());
        Self {
            code: LedgerErrorCode::CapacityExceeded,
            operation,
            command_id: Some(command_id.into()),
            capacity_exhaustion_causes: causes,
            detail: detail.into(),
        }
    }

    pub fn storage(operation: &'static str, error: rusqlite::Error) -> Self {
        Self::new(LedgerErrorCode::Storage, operation, error.to_string())
    }

    pub fn io(operation: &'static str, error: io::Error) -> Self {
        Self::new(LedgerErrorCode::Io, operation, error.to_string())
    }

    pub fn detail(&self) -> &str {
        &self.detail
    }

    pub fn capacity_exhaustion_causes(&self) -> &[LedgerCapacityExhaustionCause] {
        &self.capacity_exhaustion_causes
    }
}

impl fmt::Display for LedgerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{:?} during {}{}: {}",
            self.code,
            self.operation,
            self.command_id
                .as_deref()
                .map(|id| format!(" for command {id}"))
                .unwrap_or_default(),
            self.detail
        )
    }
}

impl std::error::Error for LedgerError {}
