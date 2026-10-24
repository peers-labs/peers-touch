//! Desktop identity, original-store publication and scheduling bindings.

use std::sync::Arc;

use search_core::runtime::{SearchBinding, SearchExecutor};
use search_core::{SearchContributor, SearchError, SourceFuture};
use sha2::{Digest, Sha256};

use super::messaging::{MessagingContributor, BINDING, SOURCE};
use crate::messaging::MessagingEngine;
use crate::state::AppState;

#[derive(Default, Clone)]
pub struct DesktopSearchExecutor;

impl SearchExecutor for DesktopSearchExecutor {
    fn spawn(&self, job: Box<dyn FnOnce() + Send>) {
        tauri::async_runtime::spawn_blocking(job);
    }

    fn block_on<T: Send>(&self, future: SourceFuture<'_, T>) -> Result<T, SearchError> {
        tauri::async_runtime::block_on(future)
    }

    fn observe_read(&self, source_read: bool, refresh: bool) {
        tracing::debug!(target: "search", source_read, refresh, "Search read");
    }

    fn observe_hydration(&self, source_reads: usize, resources: usize, refresh: bool) {
        tracing::debug!(target: "search", source_reads, resources, refresh, "Search hydration");
    }
}

#[derive(Clone)]
pub struct Binding {
    pub state: Arc<AppState>,
    pub window: String,
    pub account: String,
    pub revision: u64,
    pub engine: Arc<MessagingEngine>,
    pub source_revision: String,
    pub partition: String,
}

impl Binding {
    pub fn new(
        state: Arc<AppState>,
        window: String,
        account: String,
        revision: u64,
        engine: Arc<MessagingEngine>,
    ) -> Result<Self, SearchError> {
        let source_revision = engine
            .search_revision()
            .map_err(SearchError::SourceUnavailable)?;
        let partition = format!(
            "{window}\0{}",
            hex::encode(Sha256::digest(
                format!("{account}\0{revision}\0{}", engine.incarnation()).as_bytes(),
            ))
        );
        Ok(Self {
            state,
            window,
            account,
            revision,
            engine,
            source_revision,
            partition,
        })
    }
}

impl SearchBinding for Binding {
    fn partition(&self) -> &str {
        &self.partition
    }
    fn source_revision(&self) -> &str {
        &self.source_revision
    }
    fn source_id(&self) -> &str {
        SOURCE
    }
    fn binding_id(&self) -> &str {
        BINDING
    }

    fn check(&self) -> Result<(), SearchError> {
        let (_, revision) = self
            .state
            .sessions
            .get_with_revision(&self.window)
            .ok_or(SearchError::Cancelled)?;
        let current = self
            .state
            .messaging_engines
            .get(&self.account)
            .map_err(|_| SearchError::Cancelled)?
            .ok_or(SearchError::Cancelled)?;
        if revision != self.revision || !Arc::ptr_eq(&current, &self.engine) {
            return Err(SearchError::Cancelled);
        }
        Ok(())
    }

    fn publish<T>(
        &self,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let _identity = self
            .state
            .identity_transition
            .lock()
            .map_err(|_| SearchError::Cancelled)?;
        self.check()?;
        self.engine
            .with_search_revision(&self.source_revision, publish)
    }

    fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError> {
        Ok(Arc::new(MessagingContributor::new(
            self.engine.clone(),
            self.source_revision.clone(),
            self.state.search_cursors.clone(),
        )?))
    }
}
