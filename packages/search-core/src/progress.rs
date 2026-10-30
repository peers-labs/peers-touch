//! Progressive source observations for one first-page FIND.
//!
//! A progress frame is published after a single source finishes query plus
//! authorized hydration, on the same `query_all` pipeline that later fuses
//! every source with RRF. Frames are partial, cursor-less observations: they
//! never replace the fused final frame, enter the reusable read cache, or
//! grant open rights by themselves. The host binding's publication guard
//! validates identity before the observer is invoked.

use std::sync::Arc;

use crate::model::wire::SearchResponse;

/// One completed source's snapshot within one in-flight FIND.
#[derive(Debug, Clone)]
pub struct ProgressFrame {
    /// The source whose query and bounded hydration just completed.
    pub source_id: String,
    /// Partial response: this source's authorized items, the full current
    /// source-state vector and the full coverage vector. It never carries a
    /// continuation cursor.
    pub response: SearchResponse,
}

impl ProgressFrame {
    pub(crate) fn new(source_id: String, response: SearchResponse) -> Self {
        Self {
            source_id,
            response,
        }
    }
}

/// Receives progressive frames on an executor worker thread.
///
/// Infallible by contract: observing is a side channel and must never change
/// query semantics. Cancellation, deadline and identity fences are enforced by
/// the coordinator before each call.
pub trait ProgressObserver: Send + Sync {
    fn observe(&self, frame: ProgressFrame);
}

/// Shared, optionally absent observer.
pub(crate) type SharedObserver = Arc<dyn ProgressObserver>;

pub(crate) struct NoopObserver;

impl ProgressObserver for NoopObserver {
    fn observe(&self, _frame: ProgressFrame) {}
}

impl<F> ProgressObserver for F
where
    F: Fn(ProgressFrame) + Send + Sync,
{
    fn observe(&self, frame: ProgressFrame) {
        self(frame)
    }
}
