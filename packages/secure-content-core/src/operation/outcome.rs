use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationErrorCode {
    InvalidRecord,
    InvalidTransition,
    StaleSessionGeneration,
    LostLease,
    Cancelled,
    StoreUnavailable,
    TransportUnavailable,
    KeyMaterialUnavailable,
    IntegrityFailed,
    Rejected,
}

impl OperationErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRecord => "INVALID_RECORD",
            Self::InvalidTransition => "INVALID_TRANSITION",
            Self::StaleSessionGeneration => "STALE_SESSION_GENERATION",
            Self::LostLease => "LOST_LEASE",
            Self::Cancelled => "CANCELLED",
            Self::StoreUnavailable => "STORE_UNAVAILABLE",
            Self::TransportUnavailable => "TRANSPORT_UNAVAILABLE",
            Self::KeyMaterialUnavailable => "KEY_MATERIAL_UNAVAILABLE",
            Self::IntegrityFailed => "INTEGRITY_FAILED",
            Self::Rejected => "REJECTED",
        }
    }
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
#[error("{code}: {detail}", code = .code.as_str())]
pub struct OperationFailure {
    pub code: OperationErrorCode,
    pub retry_after_unix_ms: Option<i64>,
    pub detail: String,
}

impl OperationFailure {
    pub fn terminal(code: OperationErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            retry_after_unix_ms: None,
            detail: detail.into(),
        }
    }

    pub fn retryable(
        code: OperationErrorCode,
        retry_after_unix_ms: Option<i64>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            code,
            retry_after_unix_ms,
            detail: detail.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OperationOutcome {
    Noop,
    DispatchReady,
    Committed { authoritative_readback: bool },
    UnknownOutcome,
    RetryScheduled { next_attempt_at_unix_ms: i64 },
    Rejected { code: String },
    Cancelled,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_error_codes_are_stable() {
        let cases = [
            (OperationErrorCode::InvalidRecord, "INVALID_RECORD"),
            (OperationErrorCode::InvalidTransition, "INVALID_TRANSITION"),
            (
                OperationErrorCode::StaleSessionGeneration,
                "STALE_SESSION_GENERATION",
            ),
            (OperationErrorCode::LostLease, "LOST_LEASE"),
            (OperationErrorCode::Cancelled, "CANCELLED"),
            (OperationErrorCode::StoreUnavailable, "STORE_UNAVAILABLE"),
            (
                OperationErrorCode::TransportUnavailable,
                "TRANSPORT_UNAVAILABLE",
            ),
            (
                OperationErrorCode::KeyMaterialUnavailable,
                "KEY_MATERIAL_UNAVAILABLE",
            ),
            (OperationErrorCode::IntegrityFailed, "INTEGRITY_FAILED"),
            (OperationErrorCode::Rejected, "REJECTED"),
        ];

        for (code, expected) in cases {
            assert_eq!(code.as_str(), expected);
        }
    }
}
