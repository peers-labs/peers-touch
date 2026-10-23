//! Source ports and cancellation.
//!
//! The coordinator executes one semantic query over ports owned by the
//! messaging/application layers. Ports are traits only: this crate never
//! opens a database, calls Tauri, or speaks to a Station. The device
//! milestone implements message, conversation, attachment-name, and function
//! catalog ports against existing owners; Station and federation ports are
//! later plans and must be rejected at admission if named here prematurely.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::model::{ResultKind, ScoredDocument, SourceCoverage};
use crate::PageCursor;

/// Kind filter applied to a port query.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum KindFilter {
    #[default]
    All,
    Only(ResultKind),
}

/// Inputs for one port retrieval.
#[derive(Debug, Clone)]
pub struct PortQuery {
    pub raw: String,
    pub kind: KindFilter,
    pub limit: u32,
    pub cursor: Option<PageCursor>,
}

/// One page returned by a port.
#[derive(Debug, Clone, Default)]
pub struct PortPage {
    pub documents: Vec<ScoredDocument>,
    pub coverage: SourceCoverage,
    pub next_offset: Option<u64>,
}

/// Port over device-held messaging data (messages, conversations, and
/// attachment names from the encrypted local FTS projection).
pub trait MessageSearchPort: Send + Sync {
    fn search(
        &self,
        query: &PortQuery,
        cancel: &CancelToken,
    ) -> impl std::future::Future<Output = Result<PortPage, SearchError>> + Send;
}

/// Port over the trusted function descriptor catalog. Function results are
/// local navigation and carry [`TrustZone::Unspecified`].
pub trait FunctionCatalogPort: Send + Sync {
    fn search(
        &self,
        query: &PortQuery,
        cancel: &CancelToken,
    ) -> impl std::future::Future<Output = Result<PortPage, SearchError>> + Send;
}

/// Cooperative cancellation shared between a request and its port reads.
#[derive(Clone)]
pub struct CancelToken {
    cancelled: Arc<AtomicBool>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub fn check(&self) -> Result<(), SearchError> {
        if self.is_cancelled() {
            Err(SearchError::Cancelled)
        } else {
            Ok(())
        }
    }
}

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SearchError {
    #[error("scope is outside the closed search domain")]
    OutsideDomain,
    #[error("invalid search query")]
    InvalidQuery,
    #[error("search cancelled")]
    Cancelled,
    #[error("search source unavailable: {0}")]
    SourceUnavailable(String),
    #[error("search cursor expired")]
    CursorExpired,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_token_is_shared_and_observable() {
        let token = CancelToken::new();
        assert!(token.check().is_ok());
        let clone = token.clone();
        clone.cancel();
        assert!(token.is_cancelled());
        assert_eq!(token.check().unwrap_err(), SearchError::Cancelled);
    }
}
