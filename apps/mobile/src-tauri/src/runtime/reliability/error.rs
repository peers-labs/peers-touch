use std::fmt;

pub type ReliabilityResult<T> = Result<T, ReliabilityError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReliabilityErrorKind {
    InvalidInput,
    Io,
    CorruptState,
    KeyUnavailable,
    EpochMismatch,
    AuthenticationFailed,
    LegacyDispositionRequired,
    ResetIncomplete,
    StoreClosed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReliabilityError {
    kind: ReliabilityErrorKind,
    message: String,
}

impl ReliabilityError {
    pub fn new(kind: ReliabilityErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn kind(&self) -> ReliabilityErrorKind {
        self.kind
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ReliabilityErrorKind::InvalidInput, message)
    }

    pub fn io(operation: &str, error: impl fmt::Display) -> Self {
        Self::new(ReliabilityErrorKind::Io, format!("{operation}: {error}"))
    }

    pub fn corrupt(message: impl Into<String>) -> Self {
        Self::new(ReliabilityErrorKind::CorruptState, message)
    }

    pub fn key_unavailable(message: impl Into<String>) -> Self {
        Self::new(ReliabilityErrorKind::KeyUnavailable, message)
    }

    pub fn authentication(message: impl Into<String>) -> Self {
        Self::new(ReliabilityErrorKind::AuthenticationFailed, message)
    }
}

impl fmt::Display for ReliabilityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for ReliabilityError {}
