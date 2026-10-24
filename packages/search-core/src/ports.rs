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

use crate::model::wire::{
    HydrationReply, HydrationRequest, QueryIntent, ResolvedResource, ResourceRef,
    SearchContributorDescriptor, SourcePage,
};
use std::future::Future;
use std::pin::Pin;
use std::time::Instant;

pub type SourceFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, SearchError>> + Send + 'a>>;

/// Trusted host binding, never supplied by the source or an IPC caller.
/// Cancellation belongs to the shared operation, not its first subscriber.
#[derive(Clone)]
pub struct SearchExecutionContext {
    pub partition: String,
    pub read_scope: String,
    pub binding_revision: String,
    pub deadline: Instant,
    pub cancel: CancelToken,
}

impl SearchExecutionContext {
    pub fn check(&self) -> Result<(), SearchError> {
        self.cancel.check()?;
        if Instant::now() >= self.deadline {
            return Err(SearchError::Timeout);
        }
        Ok(())
    }
}

/// One object-safe read interface for built-in and future host-bound sources.
/// No database, UI lifetime, endpoint, Describe or per-source Cancel API.
pub trait SearchContributor: Send + Sync {
    fn descriptor(&self) -> &SearchContributorDescriptor;
    fn query<'a>(
        &'a self,
        input: &'a QueryIntent,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, SourcePage>;
    fn hydrate<'a>(
        &'a self,
        input: &'a HydrationRequest,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, HydrationReply>;
    fn resolve<'a>(
        &'a self,
        resource: &'a ResourceRef,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, ResolvedResource>;
}

/// Cooperative cancellation shared between a request and its port reads.
#[derive(Clone)]
pub struct CancelToken {
    cancelled: Arc<AtomicBool>,
    members: Arc<Vec<CancelToken>>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            members: Arc::new(Vec::new()),
        }
    }

    /// A batched backend read continues while any member still has subscribers.
    pub fn all(members: Vec<CancelToken>) -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            members: Arc::new(members),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
            || (!self.members.is_empty() && self.members.iter().all(Self::is_cancelled))
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
    #[error("search source timed out")]
    Timeout,
    #[error("search contributor protocol error")]
    Protocol,
    #[error("resource unavailable")]
    ResourceUnavailable,
    #[error("search source changed")]
    SourceChanged,
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
