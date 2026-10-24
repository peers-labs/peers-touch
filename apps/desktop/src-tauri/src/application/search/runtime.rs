//! Desktop authentication composes independent original-domain read owners.

use std::sync::Arc;

use messaging_core::search::MessagingSearchReader;
use search_core::model::wire::*;
use search_core::runtime::{ReadAuthority, SearchBinding, SearchExecutor};
use search_core::{SearchContributor, SearchError, SourceFuture};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use super::messaging::{MessagingContributor, BINDING, SOURCE};
use super::social;
use crate::domain::identity::ActiveSession;
use crate::messaging::MessagingEngine;
use crate::secure_content::SecureContentSearchBinding;
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

struct Identity {
    state: Arc<AppState>,
    session: ActiveSession,
    revision: u64,
    station_scope: crate::application::station_runtime::client::StationRequestScope,
    messaging: Option<Arc<MessagingEngine>>,
    private: Option<SecureContentSearchBinding>,
    partition: String,
}

#[derive(Clone)]
pub struct Binding {
    identity: Arc<Identity>,
    source: SourceReadState,
}

pub struct Composition {
    pub bindings: Vec<Binding>,
    pub partition: String,
}

impl Binding {
    pub fn admit(state: Arc<AppState>, window: &str) -> Result<Composition, SearchError> {
        let _transition = state
            .identity_transition
            .lock()
            .map_err(|_| SearchError::Cancelled)?;
        let (mut session, revision) = state
            .sessions
            .get_with_revision(window)
            .ok_or(SearchError::Cancelled)?;
        if session.actor.ptid.is_empty() || session.jwt.is_empty() {
            return Err(SearchError::Cancelled);
        }
        let station_scope = state
            .station
            .client()
            .active_scope()
            .ok_or(SearchError::Cancelled)?;
        let messaging = state
            .messaging_engines
            .get(&session.account_id)
            .map_err(|_| SearchError::Cancelled)?;
        let private = state
            .secure_content
            .search_binding(
                window,
                &session.account_id,
                &session.actor.ptid,
                &session.jwt,
            )
            .ok();
        session.jwt.zeroize();
        let partition = format!(
            "{window}\0{}",
            hex::encode(Sha256::digest(
                format!(
                    "{}\0{}\0{revision}\0{:?}",
                    session.account_id, session.actor.ptid, station_scope
                )
                .as_bytes(),
            ))
        );
        let identity = Arc::new(Identity {
            state: state.clone(),
            session,
            revision,
            station_scope,
            messaging,
            private,
            partition: partition.clone(),
        });
        let message_revision = identity
            .messaging
            .as_ref()
            .and_then(|e| e.search_revision().ok());
        let private_revision = identity
            .private
            .as_ref()
            .and_then(|e| e.search_revision().ok());
        let private_validity = identity
            .private
            .as_ref()
            .and_then(|e| e.read_validity().ok());
        let source_state = |id: &str,
                            binding: &str,
                            revision: Option<String>,
                            extent: CoverageExtent,
                            no_store: bool| {
            SourceReadState {
                source_id: id.into(),
                binding_id: binding.into(),
                state: if revision.is_some() {
                    SourceState::Ready
                } else {
                    SourceState::Unavailable
                } as i32,
                source_revision: revision.unwrap_or_default(),
                read_scope: partition.clone(),
                policy_revision: String::new(),
                extent: extent as i32,
                no_store,
            }
        };
        let mut message = source_state(
            SOURCE,
            BINDING,
            message_revision,
            CoverageExtent::DeclaredScope,
            false,
        );
        message.policy_revision = message.source_revision.clone();
        if identity
            .messaging
            .as_ref()
            .is_some_and(|e| e.search_index_ready().is_ok_and(|r| !r))
        {
            message.state = SourceState::Indexing as i32;
            message.extent = CoverageExtent::Recovering as i32;
        }
        let mut private = source_state(
            social::DEVICE_SOURCE,
            social::DEVICE_BINDING,
            private_revision,
            CoverageExtent::AcquiredLocal,
            true,
        );
        if let Some(validity) = private_validity {
            private.read_scope = validity.read_scope;
            private.policy_revision = validity.policy_revision;
        }
        if identity
            .private
            .as_ref()
            .is_some_and(|e| e.search_index_ready().is_ok_and(|r| !r))
        {
            private.state = SourceState::Indexing as i32;
            private.extent = CoverageExtent::Recovering as i32;
        }
        let public = SourceReadState {
            source_id: social::PUBLIC_SOURCE.into(),
            binding_id: social::PUBLIC_BINDING.into(),
            source_revision: String::new(),
            policy_revision: String::new(),
            read_scope: social::public_read_scope(&identity.session.actor.ptid),
            state: SourceState::Ready as i32,
            extent: CoverageExtent::DeclaredScope as i32,
            no_store: true,
        };
        Ok(Composition {
            partition,
            bindings: [message, private, public]
                .into_iter()
                .map(|source| Self {
                    identity: identity.clone(),
                    source,
                })
                .collect(),
        })
    }

    fn check_identity(&self) -> Result<(), SearchError> {
        let identity = &self.identity;
        let (current, revision) = identity
            .state
            .sessions
            .get_with_revision(&identity.session.window_label)
            .ok_or(SearchError::Cancelled)?;
        if revision != identity.revision
            || current.account_id != identity.session.account_id
            || current.actor.ptid != identity.session.actor.ptid
            || identity.state.station.client().active_scope().as_ref()
                != Some(&identity.station_scope)
        {
            return Err(SearchError::Cancelled);
        }
        Ok(())
    }

    fn publish_vector<T>(
        &self,
        sources: &[SourceReadState],
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let identity = &self.identity;
        let _transition = identity
            .state
            .identity_transition
            .lock()
            .map_err(|_| SearchError::Cancelled)?;
        self.check_identity()?;
        let message = sources.iter().find(|s| s.source_id == SOURCE);
        let private = sources
            .iter()
            .find(|s| s.source_id == social::DEVICE_SOURCE);
        if sources.iter().any(|s| {
            !matches!(
                s.source_id.as_str(),
                SOURCE | social::DEVICE_SOURCE | social::PUBLIC_SOURCE
            )
        }) || sources.iter().any(|s| {
            s.source_id == social::PUBLIC_SOURCE
                && (s.binding_id != social::PUBLIC_BINDING
                    || s.read_scope != social::public_read_scope(&identity.session.actor.ptid)
                    || !s.no_store)
        }) {
            return Err(SearchError::Protocol);
        }
        let publish_private = || {
            if let Some(source) = private {
                if source.binding_id != social::DEVICE_BINDING {
                    return Err(SearchError::Protocol);
                }
                if let Some(reader) = &identity.private {
                    return identity.state.secure_content.with_current_search(
                        &reader.key,
                        |store| {
                            if source.state == SourceState::Unavailable as i32 {
                                publish()
                            } else {
                                store.with_search_revision(&source.source_revision, publish)
                            }
                        },
                    );
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
            if let Some(engine) = &identity.messaging {
                let current = identity
                    .state
                    .messaging_engines
                    .get(&identity.session.account_id)
                    .map_err(|_| SearchError::Cancelled)?
                    .ok_or(SearchError::Cancelled)?;
                if !Arc::ptr_eq(&current, engine) {
                    return Err(SearchError::Cancelled);
                }
                return if source.state == SourceState::Unavailable as i32 {
                    publish_private()
                } else {
                    engine.with_search_revision(&source.source_revision, publish_private)
                };
            }
            if source.state != SourceState::Unavailable as i32 {
                return Err(SearchError::SourceChanged);
            }
            if identity
                .state
                .messaging_engines
                .get(&identity.session.account_id)
                .map_err(|_| SearchError::Cancelled)?
                .is_some()
            {
                return Err(SearchError::SourceChanged);
            }
        }
        publish_private()
    }
}

impl SearchBinding for Binding {
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
    fn check(&self) -> Result<(), SearchError> {
        self.publish(|| Ok(()))
    }
    fn publish<T>(
        &self,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        self.publish_vector(std::slice::from_ref(&self.source), publish)
    }
    fn publish_sources<T>(
        &self,
        sources: &[SourceReadState],
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        self.publish_vector(sources, publish)
    }
    fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError> {
        let identity = &self.identity;
        match self.source_id() {
            SOURCE => Ok(Arc::new(MessagingContributor::new(
                identity.messaging.clone().ok_or_else(|| {
                    SearchError::SourceUnavailable("Messaging unavailable".into())
                })?,
                self.source.source_revision.clone(),
                identity.state.search_cursors.clone(),
            )?)),
            social::DEVICE_SOURCE => social::private_contributor(
                identity.private.clone().ok_or_else(|| {
                    SearchError::SourceUnavailable("private Social unavailable".into())
                })?,
                self.source.clone(),
                identity.state.search_cursors.clone(),
            ),
            social::PUBLIC_SOURCE => Ok(social::public_contributor(
                identity.state.clone(),
                identity.station_scope.clone(),
                identity.session.actor.ptid.clone(),
                identity.session.window_label.clone(),
                identity.revision,
            )),
            _ => Err(SearchError::OutsideDomain),
        }
    }
}
