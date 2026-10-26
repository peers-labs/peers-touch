//! Fresh original Social authority checks over bounded retained projections.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::time::Instant;

use search_core::{ResourceRef, ResultKind, ScoredDocument};

use crate::model::social::{
    CheckMomentReadPolicyRequest, CheckMomentReadPolicyResponse, MomentReadDecision,
    MomentReadPolicyTarget,
};
use crate::social::search_projection::{AUTHORITY, COMMENT, POST};

use super::adapter::SecureContentTransport;
use super::search::{SearchDocumentPage, SearchTargetWindow, SEARCH_BATCH_MAX};
use super::SecureContentSearchBinding;

type ReadCheck<'a> = &'a (dyn Fn() -> Result<(), String> + Sync);

fn policy_request(resources: &[ResourceRef]) -> Result<CheckMomentReadPolicyRequest, String> {
    if resources.len() > SEARCH_BATCH_MAX {
        return Err("private Social policy batch exceeds its bound".to_string());
    }
    let mut ids = HashSet::new();
    let mut targets = Vec::with_capacity(resources.len());
    for resource in resources {
        if resource.authority_namespace != AUTHORITY
            || resource.id.trim().is_empty()
            || resource.id.trim() != resource.id
            || !resource.conversation_id.is_empty()
            || !resource.message_id.is_empty()
            || !resource.target_page.is_empty()
        {
            return Err("private Social policy resource is invalid".to_string());
        }
        let (post_id, comment_id) = match resource.kind.as_str() {
            POST if resource.parent.is_none() => (resource.id.clone(), String::new()),
            COMMENT => {
                let parent = resource
                    .parent
                    .as_ref()
                    .filter(|parent| {
                        parent.kind == POST
                            && parent.authority_namespace == AUTHORITY
                            && !parent.id.trim().is_empty()
                            && parent.id.trim() == parent.id
                            && parent.parent.is_none()
                            && parent.conversation_id.is_empty()
                            && parent.message_id.is_empty()
                            && parent.target_page.is_empty()
                    })
                    .ok_or_else(|| "private Social policy parent is invalid".to_string())?;
                (parent.id.clone(), resource.id.clone())
            }
            _ => return Err("private Social policy kind is invalid".to_string()),
        };
        let anchor_kind = if comment_id.is_empty() {
            "post"
        } else {
            "comment"
        };
        if resource
            .anchor
            .as_ref()
            .is_some_and(|anchor| anchor.kind != anchor_kind || anchor.id != resource.id)
            || (!comment_id.is_empty() && resource.anchor.is_none())
        {
            return Err("private Social policy anchor is invalid".to_string());
        }
        let item_id = format!("{}:{}", resource.kind, resource.id);
        if !ids.insert(item_id.clone()) {
            return Err("private Social policy item is duplicated".to_string());
        }
        targets.push(MomentReadPolicyTarget {
            item_id,
            post_id,
            comment_id,
        });
    }
    Ok(CheckMomentReadPolicyRequest { targets })
}

fn authorized_resources(
    resources: Vec<ResourceRef>,
    request: &CheckMomentReadPolicyRequest,
    response: CheckMomentReadPolicyResponse,
) -> Result<Vec<ResourceRef>, String> {
    if response.outcomes.len() != request.targets.len() {
        return Err("private Social policy response is incomplete".to_string());
    }
    let expected = request
        .targets
        .iter()
        .map(|target| target.item_id.as_str())
        .collect::<HashSet<_>>();
    let mut decisions = HashMap::new();
    for outcome in response.outcomes {
        let decision = MomentReadDecision::try_from(outcome.decision)
            .map_err(|_| "private Social policy decision is invalid".to_string())?;
        if !expected.contains(outcome.item_id.as_str())
            || !matches!(
                decision,
                MomentReadDecision::Readable | MomentReadDecision::Unavailable
            )
            || decisions.insert(outcome.item_id, decision).is_some()
        {
            return Err("private Social policy response is invalid".to_string());
        }
    }
    Ok(resources
        .into_iter()
        .zip(&request.targets)
        .filter_map(|(resource, target)| {
            (decisions.get(&target.item_id) == Some(&MomentReadDecision::Readable))
                .then_some(resource)
        })
        .collect())
}

impl SecureContentSearchBinding {
    fn check_search_read(&self, deadline: Instant, check: ReadCheck<'_>) -> Result<(), String> {
        check()?;
        if Instant::now() >= deadline
            || !self.session.search_is_authorized()
            || self.store.session_generation.load(Ordering::Acquire) != self.key.session_generation
        {
            return Err("private Social search binding or deadline is stale".to_string());
        }
        Ok(())
    }

    pub fn search_revision(&self) -> Result<String, String> {
        if !self.session.search_is_authorized()
            || self.store.session_generation.load(Ordering::Acquire) != self.key.session_generation
        {
            return Err("private Social search binding is stale".to_string());
        }
        self.store.search_revision()
    }

    fn operation_revision(
        &self,
        deadline: Instant,
        check: ReadCheck<'_>,
    ) -> Result<String, String> {
        self.store
            .search_revision_checked(&|| self.check_search_read(deadline, check))
    }

    pub fn search_index_ready(&self) -> Result<bool, String> {
        self.search_revision()?;
        self.store.search_index_ready()
    }

    /// Neither a server snapshot nor a local revision grants cache reuse.
    pub fn cache_metadata(&self) -> Result<search_core::model::wire::CacheMetadata, String> {
        Ok(search_core::model::wire::CacheMetadata {
            source_revision: self.search_revision()?,
            read_validity: Some(self.read_validity()?),
            no_store: true,
            ..Default::default()
        })
    }

    fn authorize_search_refs(
        &self,
        resources: Vec<ResourceRef>,
        revision: &str,
        deadline: Instant,
        check: ReadCheck<'_>,
    ) -> Result<Vec<ResourceRef>, String> {
        self.check_search_read(deadline, check)?;
        if self.operation_revision(deadline, check)? != revision {
            return Err("private Social search source changed".to_string());
        }
        let request = policy_request(&resources)?;
        if resources.is_empty() {
            return Ok(resources);
        }
        let response = SecureContentTransport::new(self.session.clone())?
            .check_moment_read_policy(&request, deadline, check)
            .map_err(|_| "private Social current read policy is unavailable".to_string())?;
        self.check_search_read(deadline, check)?;
        if self.operation_revision(deadline, check)? != revision {
            return Err("private Social search source changed".to_string());
        }
        authorized_resources(resources, &request, response)
    }

    fn finish_search_read(
        &self,
        revision: &str,
        deadline: Instant,
        check: ReadCheck<'_>,
    ) -> Result<(), String> {
        self.check_search_read(deadline, check)?;
        if self.operation_revision(deadline, check)? != revision {
            return Err("private Social search source changed".to_string());
        }
        Ok(())
    }

    /// `check` is cancellation/deadline-only: do not reacquire Store, supervisor
    /// or host identity locks. The host still fences final bytes publication.
    #[cfg(test)]
    pub fn search_documents(
        &self,
        query: &str,
        kinds: &[ResultKind],
        before: Option<(i64, &str, &str)>,
        limit: usize,
        deadline: Instant,
        check: ReadCheck<'_>,
    ) -> Result<Vec<ScoredDocument>, String> {
        self.search_documents_page(query, kinds, before, limit, deadline, check)
            .map(|page| page.documents)
    }

    /// Source paging advances past denied rows, never from filtered result count.
    pub fn search_documents_page(
        &self,
        query: &str,
        kinds: &[ResultKind],
        before: Option<(i64, &str, &str)>,
        limit: usize,
        deadline: Instant,
        check: ReadCheck<'_>,
    ) -> Result<SearchDocumentPage, String> {
        self.check_search_read(deadline, check)?;
        let revision = self.operation_revision(deadline, check)?;
        let checked = || self.check_search_read(deadline, check);
        let page = self
            .store
            .search_candidate_refs(query, kinds, before, limit, &checked)?;
        let refs = page.resources;
        let positions = refs
            .iter()
            .enumerate()
            .map(|(position, resource)| ((resource.kind.clone(), resource.id.clone()), position))
            .collect::<HashMap<_, _>>();
        let authorized = self.authorize_search_refs(refs, &revision, deadline, check)?;
        let mut documents = self.store.search_read_resources(&authorized, &checked)?;
        documents.sort_by_key(|doc| {
            positions
                .get(&(doc.resource.kind.clone(), doc.resource.id.clone()))
                .copied()
        });
        for document in &mut documents {
            let position = positions
                .get(&(document.resource.kind.clone(), document.resource.id.clone()))
                .ok_or_else(|| "private Social search resource changed".to_string())?;
            document.score = 1.0 / (position + 1) as f64;
        }
        self.finish_search_read(&revision, deadline, check)?;
        Ok(SearchDocumentPage {
            documents,
            next_before: page.next_before,
        })
    }

    pub fn search_read_resources(
        &self,
        refs: &[ResourceRef],
        deadline: Instant,
        check: ReadCheck<'_>,
    ) -> Result<Vec<ScoredDocument>, String> {
        self.check_search_read(deadline, check)?;
        policy_request(refs)?;
        let revision = self.operation_revision(deadline, check)?;
        let checked = || self.check_search_read(deadline, check);
        let refs = self.store.search_resource_refs(refs, &checked)?;
        let authorized = self.authorize_search_refs(refs, &revision, deadline, check)?;
        let documents = self.store.search_read_resources(&authorized, &checked)?;
        self.finish_search_read(&revision, deadline, check)?;
        Ok(documents)
    }

    /// Exact bounded opener port, independent of feed and renderer generation.
    /// A comment window reserves one of the 100 policy targets for its parent.
    pub fn search_read_target_window(
        &self,
        post_id: &str,
        anchor_comment_id: Option<&str>,
        limit: usize,
        deadline: Instant,
        check: ReadCheck<'_>,
    ) -> Result<Option<SearchTargetWindow>, String> {
        self.check_search_read(deadline, check)?;
        let revision = self.operation_revision(deadline, check)?;
        let checked = || self.check_search_read(deadline, check);
        let refs = self
            .store
            .search_target_refs(post_id, anchor_comment_id, limit, &checked)?;
        let authorized = self.authorize_search_refs(refs, &revision, deadline, check)?;
        let target = self.store.search_read_target_window(
            post_id,
            anchor_comment_id,
            &authorized,
            &checked,
        )?;
        self.finish_search_read(&revision, deadline, check)?;
        Ok(target)
    }
}

#[cfg(test)]
#[path = "search_policy_tests.rs"]
mod tests;
