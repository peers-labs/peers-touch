//! Read-only Search binding over the original private Social owner.
use std::sync::Arc;
use std::time::Instant;

use search_core::{ResourceRef, ResultKind, ScoredDocument, SearchError};
use zeroize::Zeroizing;

use super::{MobilePrivateSocialRuntime, PrivateSocialEngine};
use crate::runtime::oauth::session::AuthenticatedNativeSession;
use crate::secure_content::proto::social::v1 as social;
use crate::secure_content::store::{SearchBoundary, SearchDocumentPage, SEARCH_BATCH_MAX};
use crate::secure_content::transport::{validated_moment_read_decisions, NativeSocialTransport};

/// No keys are exported. The host rechecks OAuth and OS admission through `check`.
/// No offline policy lease exists; publication requires the original batch policy port.
pub struct PrivateSocialSearchReader {
    engine: Arc<PrivateSocialEngine>,
    access_token: Zeroizing<String>,
}

impl PrivateSocialSearchReader {
    pub fn search_revision(&self) -> Result<String, String> {
        self.engine.ensure_current()?;
        self.engine.store.search_revision()
    }

    pub fn search_authorities(&self) -> Result<Vec<String>, String> {
        self.engine.ensure_current()?;
        self.engine.store.search_authorities()
    }

    pub fn search_index_ready(&self) -> Result<bool, String> {
        self.engine.ensure_current()?;
        self.engine.store.search_index_ready()
    }

    pub fn search_documents(
        &self,
        query: &str,
        kinds: &[ResultKind],
        before: Option<SearchBoundary<'_>>,
        limit: usize,
        deadline: Instant,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        self.search_documents_page(query, kinds, before, limit, deadline, check)
            .map(|page| page.documents)
    }

    pub fn search_documents_page(
        &self,
        query: &str,
        kinds: &[ResultKind],
        before: Option<SearchBoundary<'_>>,
        limit: usize,
        deadline: Instant,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<SearchDocumentPage, String> {
        let revision = self.search_revision()?;
        let page = self
            .engine
            .store
            .search_documents_page(query, kinds, before, limit, deadline, check)?;
        Ok(SearchDocumentPage {
            documents: self.validate_documents(page.documents, &revision, deadline, check)?,
            next_before: page.next_before,
        })
    }

    pub fn search_read_resources(
        &self,
        refs: &[ResourceRef],
        deadline: Instant,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        let revision = self.search_revision()?;
        let documents = self
            .engine
            .store
            .search_read_resources(refs, deadline, check)?;
        self.validate_documents(documents, &revision, deadline, check)
    }

    fn validate_documents(
        &self,
        documents: Vec<ScoredDocument>,
        revision: &str,
        deadline: Instant,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        check()?;
        if documents.len() > SEARCH_BATCH_MAX {
            return Err("private Social read batch exceeds its bound".into());
        }
        self.engine.ensure_current()?;
        if self.search_revision()? != revision {
            return Err("private Social search source changed".into());
        }
        check()?;
        if documents.is_empty() {
            return Ok(documents);
        }
        if Instant::now() >= deadline {
            return Err("private Social policy deadline expired".into());
        }
        let request = social::CheckMomentReadPolicyRequest {
            targets: documents
                .iter()
                .enumerate()
                .map(|(index, document)| {
                    let (post_id, comment_id) = match document.resource.kind.as_str() {
                        "social-post" => (document.resource.id.clone(), String::new()),
                        "social-comment" => {
                            let parent = document
                                .resource
                                .parent
                                .as_deref()
                                .ok_or("private Social read-policy protocol error")?;
                            if parent.kind != "social-post"
                                || parent.authority_namespace
                                    != document.resource.authority_namespace
                            {
                                return Err("private Social read-policy protocol error".to_string());
                            }
                            (parent.id.clone(), document.resource.id.clone())
                        }
                        _ => return Err("private Social read-policy protocol error".to_string()),
                    };
                    Ok(social::MomentReadPolicyTarget {
                        item_id: format!("item-{index}"),
                        post_id,
                        comment_id,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?,
        };
        let transport = NativeSocialTransport::for_search_read(
            self.engine.session.clone(),
            self.access_token.clone(),
            deadline,
        )?;
        let response = transport
            .check_moment_read_policy(&request)
            .map_err(|e| e.to_string())?;
        let decisions = validated_moment_read_decisions(&request, &response)?;
        check()?;
        if Instant::now() >= deadline {
            return Err("private Social policy deadline expired".into());
        }
        // This is a current remote snapshot, never an offline grant or lease.
        let authorized = documents
            .into_iter()
            .zip(decisions)
            .filter_map(|(document, readable)| readable.then_some(document))
            .collect();
        self.engine
            .store
            .with_search_revision(revision, || Ok(authorized))
            .map_err(|e| e.to_string())
    }

    /// Must be nested inside OAuth -> OS -> active Social publication admission.
    /// Do not invoke another store method inside this closure.
    pub fn with_search_revision<T>(
        &self,
        expected: &str,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        self.engine.store.with_search_revision(expected, publish)
    }
}

impl MobilePrivateSocialRuntime {
    /// Current native auth only. No Messaging engine or renderer generation input.
    pub(crate) fn search_reader(
        &self,
        session: &AuthenticatedNativeSession,
    ) -> Result<Arc<PrivateSocialSearchReader>, SearchError> {
        let active = self.active.lock().map_err(|_| SearchError::Cancelled)?;
        let engine = &active
            .as_ref()
            .ok_or_else(|| {
                SearchError::SourceUnavailable("private Social runtime is unavailable".into())
            })?
            .engine;
        let scope = &engine.session.scope;
        if scope.station_peer_id != session.station_peer_id()
            || scope.station_origin != session.station_origin()
            || scope.actor_ptid != session.actor_ptid()
            || scope.device_id != session.device_id()
            || engine.session.jwt_session_id != session.session_id()
            || engine.lifecycle_generation != session.lifecycle_generation()
        {
            return Err(SearchError::Cancelled);
        }
        engine
            .ensure_current()
            .map_err(|_| SearchError::Cancelled)?;
        Ok(Arc::new(PrivateSocialSearchReader {
            engine: engine.clone(),
            access_token: Zeroizing::new(session.access_token().to_string()),
        }))
    }

    pub(crate) fn with_search_reader<T>(
        &self,
        expected: &PrivateSocialSearchReader,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let active = self.active.lock().map_err(|_| SearchError::Cancelled)?;
        let current = active.as_ref().ok_or(SearchError::Cancelled)?;
        if !Arc::ptr_eq(&current.engine, &expected.engine) {
            return Err(SearchError::Cancelled);
        }
        current
            .engine
            .ensure_current()
            .map_err(|_| SearchError::Cancelled)?;
        publish()
    }
}
