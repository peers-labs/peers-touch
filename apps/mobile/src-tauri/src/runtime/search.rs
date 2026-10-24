//! Mobile host binding: native identity and lifecycle grant read publication.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use messaging_core::search::{MessagingContributor, MessagingSearchReader, BINDING, SOURCE};
use rand::RngCore;
use search_core::cursor::authenticated::AuthenticatedCursorCodec;
use search_core::model::wire::*;
use search_core::requests::SearchRequests;
use search_core::runtime::ReadAuthority;
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
use crate::social::{search::PrivateSocialSearchReader, MobilePrivateSocialRuntime};

mod social;

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
        futures_lite::future::block_on(future)
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

struct Identity<R: Runtime> {
    app: AppHandle<R>,
    engine: Option<Arc<MobileMessagingEngine>>,
    private: Option<Arc<PrivateSocialSearchReader>>,
    auth_revision: u64,
    os_generation: u64,
    session_identity: String,
    actor: String,
    partition: String,
}

pub struct Binding<R: Runtime> {
    identity: Arc<Identity<R>>,
    source: SourceReadState,
}

pub struct Composition<R: Runtime> {
    pub bindings: Vec<Binding<R>>,
    pub partition: String,
}

impl<R: Runtime> Clone for Binding<R> {
    fn clone(&self) -> Self {
        Self {
            identity: self.identity.clone(),
            source: self.source.clone(),
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
    pub fn admit(app: AppHandle<R>) -> Result<Composition<R>, SearchError> {
        let coordinator = app.state::<OAuthCoordinator>();
        coordinator.with_read_admission(None, |auth_revision| {
            with_visible_generation(None, |os_generation| {
                let storage = app.state::<SecureStorage>();
                let session = current_authenticated_native_session(&storage)
                    .map_err(|_| SearchError::Cancelled)?;
                let engine = app
                    .state::<MobileMessagingRuntime>()
                    .active_engine(session.station_peer_id(), session.actor_ptid())
                    .ok();
                if engine.as_ref().is_some_and(|engine| {
                    engine.scope().device_id != session.device_id()
                        || engine.scope().station_origin != session.station_origin()
                }) {
                    return Err(SearchError::Cancelled);
                }
                let private = app
                    .state::<MobilePrivateSocialRuntime>()
                    .search_reader(&session)
                    .ok();
                let session_identity = session_identity(&session);
                let partition = hex::encode(Sha256::digest(
                    format!("{:?}", (&session_identity, auth_revision, os_generation,)).as_bytes(),
                ));
                let message_revision = engine.as_ref().and_then(|e| e.search_revision().ok());
                let private_revision = private.as_ref().and_then(|e| e.search_revision().ok());
                let mut message = SourceReadState {
                    source_id: SOURCE.into(),
                    binding_id: BINDING.into(),
                    source_revision: message_revision.clone().unwrap_or_default(),
                    policy_revision: message_revision.clone().unwrap_or_default(),
                    read_scope: partition.clone(),
                    state: if message_revision.is_some() {
                        SourceState::Ready
                    } else {
                        SourceState::Unavailable
                    } as i32,
                    extent: CoverageExtent::DeclaredScope as i32,
                    no_store: false,
                };
                if engine
                    .as_ref()
                    .is_some_and(|e| e.search_index_ready().is_ok_and(|ready| !ready))
                {
                    message.state = SourceState::Indexing as i32;
                    message.extent = CoverageExtent::Recovering as i32;
                }
                let mut private_source = SourceReadState {
                    source_id: social::DEVICE_SOURCE.into(),
                    binding_id: social::DEVICE_BINDING.into(),
                    source_revision: private_revision.clone().unwrap_or_default(),
                    policy_revision: private_revision.clone().unwrap_or_default(),
                    read_scope: partition.clone(),
                    state: if private_revision.is_some() {
                        SourceState::Ready
                    } else {
                        SourceState::Unavailable
                    } as i32,
                    extent: CoverageExtent::AcquiredLocal as i32,
                    no_store: true,
                };
                if private
                    .as_ref()
                    .is_some_and(|e| e.search_index_ready().is_ok_and(|ready| !ready))
                {
                    private_source.state = SourceState::Indexing as i32;
                    private_source.extent = CoverageExtent::Recovering as i32;
                }
                let public = SourceReadState {
                    source_id: social::PUBLIC_SOURCE.into(),
                    binding_id: social::PUBLIC_BINDING.into(),
                    source_revision: String::new(),
                    policy_revision: String::new(),
                    read_scope: social::public_read_scope(session.actor_ptid()),
                    state: SourceState::Ready as i32,
                    extent: CoverageExtent::DeclaredScope as i32,
                    no_store: true,
                };
                let identity = Arc::new(Identity {
                    app: app.clone(),
                    engine,
                    private,
                    auth_revision,
                    os_generation,
                    session_identity,
                    actor: session.actor_ptid().into(),
                    partition: partition.clone(),
                });
                Ok(Composition {
                    partition,
                    bindings: [message, private_source, public]
                        .into_iter()
                        .map(|source| Self {
                            identity: identity.clone(),
                            source,
                        })
                        .collect(),
                })
            })
        })
    }
}

impl<R: Runtime> SearchBinding for Binding<R> {
    fn partition(&self) -> &str {
        &self.identity.partition
    }
    fn source_revision(&self) -> &str {
        &self.source.source_revision
    }
    fn source_id(&self) -> &str {
        &self.source.source_id
    }
    fn binding_id(&self) -> &str {
        &self.source.binding_id
    }
    fn check(&self) -> Result<(), SearchError> {
        self.publish(|| Ok(()))
    }
    fn publish<T>(
        &self,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        self.publish_sources(std::slice::from_ref(&self.source), publish)
    }
    fn read_authority(&self) -> ReadAuthority {
        if self.source_id() == social::PUBLIC_SOURCE {
            ReadAuthority::RemoteOwner
        } else {
            ReadAuthority::LocalSnapshot
        }
    }
    fn read_state(&self) -> Result<SourceReadState, SearchError> {
        self.check()?;
        Ok(self.source.clone())
    }
    fn publish_sources<T>(
        &self,
        sources: &[SourceReadState],
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let identity = &self.identity;
        identity
            .app
            .state::<OAuthCoordinator>()
            .with_read_admission(Some(identity.auth_revision), |_| {
                with_visible_generation(Some(identity.os_generation), |_| {
                    let storage = identity.app.state::<SecureStorage>();
                    let session = current_authenticated_native_session(&storage)
                        .map_err(|_| SearchError::Cancelled)?;
                    if session_identity(&session) != identity.session_identity {
                        return Err(SearchError::Cancelled);
                    }
                    if sources.iter().any(|s| {
                        !matches!(
                            s.source_id.as_str(),
                            SOURCE | social::DEVICE_SOURCE | social::PUBLIC_SOURCE
                        )
                    }) || sources.iter().any(|s| {
                        s.source_id == social::PUBLIC_SOURCE
                            && (s.binding_id != social::PUBLIC_BINDING
                                || s.read_scope != social::public_read_scope(&identity.actor)
                                || !s.no_store)
                    }) {
                        return Err(SearchError::Protocol);
                    }
                    let message = sources.iter().find(|s| s.source_id == SOURCE);
                    let private = sources
                        .iter()
                        .find(|s| s.source_id == social::DEVICE_SOURCE);
                    let publish_private = || {
                        if let Some(source) = private {
                            if source.binding_id != social::DEVICE_BINDING {
                                return Err(SearchError::Protocol);
                            }
                            if let Some(reader) = &identity.private {
                                return identity
                                    .app
                                    .state::<MobilePrivateSocialRuntime>()
                                    .with_search_reader(reader, || {
                                        if source.state == SourceState::Unavailable as i32 {
                                            publish()
                                        } else {
                                            reader.with_search_revision(
                                                &source.source_revision,
                                                publish,
                                            )
                                        }
                                    });
                            }
                            if source.state != SourceState::Unavailable as i32 {
                                return Err(SearchError::SourceChanged);
                            }
                        }
                        publish()
                    };
                    if let Some(source) = message {
                        if source.binding_id != BINDING {
                            return Err(SearchError::Protocol);
                        }
                        if let Some(engine) = &identity.engine {
                            return identity
                                .app
                                .state::<MobileMessagingRuntime>()
                                .with_search_engine(engine, || {
                                    if source.state == SourceState::Unavailable as i32 {
                                        publish_private()
                                    } else {
                                        engine.with_search_revision(
                                            &source.source_revision,
                                            publish_private,
                                        )
                                    }
                                });
                        }
                        if source.state != SourceState::Unavailable as i32 {
                            return Err(SearchError::SourceChanged);
                        }
                        if identity
                            .app
                            .state::<MobileMessagingRuntime>()
                            .active_engine(session.station_peer_id(), session.actor_ptid())
                            .is_ok()
                        {
                            return Err(SearchError::SourceChanged);
                        }
                    }
                    publish_private()
                })
            })
    }
    fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError> {
        let identity = &self.identity;
        match self.source_id() {
            SOURCE => Ok(Arc::new(MessagingContributor::new(
                identity.engine.clone().ok_or_else(|| {
                    SearchError::SourceUnavailable("Messaging unavailable".into())
                })?,
                self.source.source_revision.clone(),
                identity.app.state::<MobileSearchState>().cursors.clone(),
            )?)),
            social::DEVICE_SOURCE => social::private_contributor(
                identity.private.clone().ok_or_else(|| {
                    SearchError::SourceUnavailable("private Social unavailable".into())
                })?,
                self.source.clone(),
                identity.app.state::<MobileSearchState>().cursors.clone(),
            ),
            social::PUBLIC_SOURCE => Ok(social::public_contributor(
                identity.app.clone(),
                identity.auth_revision,
                identity.os_generation,
                identity.session_identity.clone(),
                identity.actor.clone(),
            )),
            _ => Err(SearchError::OutsideDomain),
        }
    }
}
