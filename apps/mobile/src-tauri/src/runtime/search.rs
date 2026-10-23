//! Mobile host binding: native identity and lifecycle grant read publication.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use messaging_core::search::{MessagingContributor, MessagingSearchReader, BINDING, SOURCE};
use rand::RngCore;
use search_core::cursor::authenticated::AuthenticatedCursorCodec;
use search_core::requests::SearchRequests;
use search_core::runtime::{SearchBinding, SearchExecutor, SearchRuntime};
use search_core::{SearchContributor, SearchError, SourceFuture};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};

use crate::messaging::engine::MobileMessagingEngine;
use crate::messaging::lifecycle::MobileMessagingRuntime;
use crate::platform::lifecycle_bridge::with_visible_generation;
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::oauth::session::current_authenticated_native_session;
use crate::runtime::oauth::OAuthCoordinator;

#[derive(Default, Clone)]
pub struct MobileSearchExecutor;

// Process-local, content-free observations from the original executor.
static SOURCE_READS: AtomicU64 = AtomicU64::new(0);
static HYDRATION_READS: AtomicU64 = AtomicU64::new(0);
static READ_OBSERVATIONS: AtomicU64 = AtomicU64::new(0);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchReadDiagnostics {
    source_reads: u64,
    hydration_reads: u64,
    observations: u64,
}

pub fn read_diagnostics() -> SearchReadDiagnostics {
    SearchReadDiagnostics {
        source_reads: SOURCE_READS.load(Ordering::SeqCst),
        hydration_reads: HYDRATION_READS.load(Ordering::SeqCst),
        observations: READ_OBSERVATIONS.load(Ordering::SeqCst),
    }
}

impl SearchExecutor for MobileSearchExecutor {
    fn spawn(&self, job: Box<dyn FnOnce() + Send>) {
        tauri::async_runtime::spawn_blocking(job);
    }
    fn block_on<T: Send>(&self, future: SourceFuture<'_, T>) -> Result<T, SearchError> {
        tauri::async_runtime::block_on(future)
    }
    fn observe_read(&self, source_read: bool, refresh: bool) {
        SOURCE_READS.fetch_add(u64::from(source_read), Ordering::SeqCst);
        READ_OBSERVATIONS.fetch_add(1, Ordering::SeqCst);
        log::debug!(target: "search", "Search read source_read={source_read} refresh={refresh}");
    }
    fn observe_hydration(&self, source_reads: usize, resources: usize, refresh: bool) {
        HYDRATION_READS.fetch_add(source_reads as u64, Ordering::SeqCst);
        READ_OBSERVATIONS.fetch_add(1, Ordering::SeqCst);
        log::debug!(target: "search", "Search hydration source_reads={source_reads} resources={resources} refresh={refresh}");
    }
}

pub struct MobileSearchState {
    pub runtime: SearchRuntime<MobileSearchExecutor>,
    pub requests: Arc<SearchRequests>,
    pub cursors: Arc<AuthenticatedCursorCodec>,
}

impl Default for MobileSearchState {
    fn default() -> Self {
        let mut key = [0; 32];
        rand::rngs::OsRng.fill_bytes(&mut key);
        Self {
            runtime: Default::default(),
            requests: Default::default(),
            cursors: Arc::new(AuthenticatedCursorCodec::new(key)),
        }
    }
}

pub struct Binding<R: Runtime> {
    app: AppHandle<R>,
    engine: Arc<MobileMessagingEngine>,
    auth_revision: u64,
    os_generation: u64,
    session_identity: String,
    pub partition: String,
    pub source_revision: String,
}

impl<R: Runtime> Clone for Binding<R> {
    fn clone(&self) -> Self {
        Self {
            app: self.app.clone(),
            engine: self.engine.clone(),
            auth_revision: self.auth_revision,
            os_generation: self.os_generation,
            session_identity: self.session_identity.clone(),
            partition: self.partition.clone(),
            source_revision: self.source_revision.clone(),
        }
    }
}

fn session_identity(
    session: &crate::runtime::oauth::session::AuthenticatedNativeSession,
) -> String {
    format!(
        "{:?}",
        (
            session.station_peer_id(),
            session.station_origin(),
            session.actor_ptid(),
            session.device_id(),
            session.session_id(),
            session.lifecycle_generation(),
        )
    )
}

impl<R: Runtime> Binding<R> {
    pub fn admit(app: AppHandle<R>) -> Result<Self, SearchError> {
        let coordinator = app.state::<OAuthCoordinator>();
        coordinator.with_read_admission(None, |auth_revision| {
            with_visible_generation(None, |os_generation| {
                let storage = app.state::<SecureStorage>();
                let session = current_authenticated_native_session(&storage)
                    .map_err(|_| SearchError::Cancelled)?;
                let engine = app
                    .state::<MobileMessagingRuntime>()
                    .active_engine(session.station_peer_id(), session.actor_ptid())
                    .map_err(|_| SearchError::Cancelled)?;
                if engine.scope().device_id != session.device_id()
                    || engine.scope().station_origin != session.station_origin()
                {
                    return Err(SearchError::Cancelled);
                }
                let session_identity = session_identity(&session);
                let partition = hex::encode(Sha256::digest(
                    format!(
                        "{:?}",
                        (
                            &session_identity,
                            auth_revision,
                            os_generation,
                            engine.incarnation(),
                        )
                    )
                    .as_bytes(),
                ));
                app.state::<MobileMessagingRuntime>()
                    .with_search_engine(&engine, || {
                        let source_revision = engine
                            .search_revision()
                            .map_err(SearchError::SourceUnavailable)?;
                        Ok(Self {
                            app: app.clone(),
                            engine: engine.clone(),
                            auth_revision,
                            os_generation,
                            session_identity,
                            partition,
                            source_revision,
                        })
                    })
            })
        })
    }
}

impl<R: Runtime> SearchBinding for Binding<R> {
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
        self.publish(|| Ok(()))
    }
    fn publish<T>(
        &self,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        self.app
            .state::<OAuthCoordinator>()
            .with_read_admission(Some(self.auth_revision), |_| {
                with_visible_generation(Some(self.os_generation), |_| {
                    let storage = self.app.state::<SecureStorage>();
                    let session = current_authenticated_native_session(&storage)
                        .map_err(|_| SearchError::Cancelled)?;
                    if session_identity(&session) != self.session_identity {
                        return Err(SearchError::Cancelled);
                    }
                    self.app
                        .state::<MobileMessagingRuntime>()
                        .with_search_engine(&self.engine, || {
                            self.engine
                                .with_search_revision(&self.source_revision, publish)
                        })
                })
            })
    }
    fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError> {
        Ok(Arc::new(MessagingContributor::new(
            self.engine.clone(),
            self.source_revision.clone(),
            self.app.state::<MobileSearchState>().cursors.clone(),
        )?))
    }
}
