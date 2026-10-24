//! Declaration and batch-reply conformance for every contributor.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::model::wire::{
    hydration_outcome, HydrationReply, HydrationRequest, QueryIntent, SearchContributorDescriptor,
    SearchKind, SourcePage,
};
use crate::{SearchContributor, SearchError};

#[derive(Default)]
pub struct ContributorRegistry {
    sources: HashMap<String, Arc<dyn SearchContributor>>,
}

pub fn validate_page(
    descriptor: &SearchContributorDescriptor,
    intent: &QueryIntent,
    page: &SourcePage,
) -> Result<(), SearchError> {
    if page.candidates.len() > intent.limit as usize
        || page.coverage.as_ref().map(|c| &c.source_id) != Some(&descriptor.source_id)
        || (!descriptor.supports_paging && !page.next_cursor.is_empty())
        || page
            .cache
            .as_ref()
            .and_then(|c| c.read_validity.as_ref())
            .is_none()
    {
        return Err(SearchError::Protocol);
    }
    let mut seen = HashSet::new();
    for candidate in &page.candidates {
        let resource = candidate.resource.as_ref().ok_or(SearchError::Protocol)?;
        let kind = match resource.kind.as_str() {
            "message" => SearchKind::Message,
            "conversation" => SearchKind::Conversation,
            "person" => SearchKind::Person,
            "social-post" => SearchKind::SocialPost,
            "agent" => SearchKind::Agent,
            "knowledge" => SearchKind::Knowledge,
            "attachment" => SearchKind::Attachment,
            "function" => SearchKind::Function,
            _ => return Err(SearchError::OutsideDomain),
        };
        if resource.id.is_empty()
            || !descriptor.kinds.contains(&(kind as i32))
            || !descriptor
                .authority_namespaces
                .contains(&resource.authority_namespace)
            || !candidate.source_rank.is_finite()
            || candidate.source_rank <= 0.0
            || !seen.insert(resource.fusion_key())
        {
            return Err(SearchError::Protocol);
        }
    }
    Ok(())
}

impl ContributorRegistry {
    /// The host resolves and authenticates the binding before registration.
    /// A descriptor does not grant access or make an unavailable source ready.
    pub fn register(&mut self, source: Arc<dyn SearchContributor>) -> Result<(), SearchError> {
        let d = source.descriptor();
        if d.source_id.is_empty()
            || d.owning_module.is_empty()
            || d.binding_id.is_empty()
            || d.descriptor_revision.is_empty()
            || d.authority_namespaces.is_empty()
            || d.authority_namespaces.iter().any(|n| n.is_empty())
            || d.max_batch == 0
            || d.max_batch > 100
            || d.kinds.is_empty()
            || d.kinds.iter().any(|k| {
                SearchKind::try_from(*k)
                    .ok()
                    .is_none_or(|k| k == SearchKind::Unspecified)
            })
            || self.sources.contains_key(&d.source_id)
        {
            return Err(SearchError::Protocol);
        }
        self.sources.insert(d.source_id.clone(), source);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Arc<dyn SearchContributor>, SearchError> {
        self.sources
            .get(id)
            .cloned()
            .ok_or_else(|| SearchError::SourceUnavailable(id.into()))
    }
}

/// Missing, duplicate, extra or mismatched outcomes are protocol failures.
/// They never become negative cache entries or silent absent resources.
pub fn validate_hydration(
    request: &HydrationRequest,
    reply: &HydrationReply,
) -> Result<(), SearchError> {
    let expected: HashMap<_, _> = request
        .items
        .iter()
        .map(|i| (i.item_id.as_str(), i))
        .collect();
    if expected.len() != request.items.len()
        || reply.outcomes.len() != expected.len()
        || expected.keys().any(|id| id.is_empty())
    {
        return Err(SearchError::Protocol);
    }
    let mut seen = HashSet::new();
    for outcome in &reply.outcomes {
        let item = expected
            .get(outcome.item_id.as_str())
            .ok_or(SearchError::Protocol)?;
        if !seen.insert(&outcome.item_id) {
            return Err(SearchError::Protocol);
        }
        match outcome.outcome.as_ref().ok_or(SearchError::Protocol)? {
            hydration_outcome::Outcome::Changed(p) => {
                let actual = p
                    .result
                    .as_ref()
                    .and_then(|r| r.resource.as_ref())
                    .ok_or(SearchError::Protocol)?;
                let requested = item.resource.as_ref().ok_or(SearchError::Protocol)?;
                if actual.fusion_key() != requested.fusion_key()
                    || p.fields != item.fields
                    || p.cache
                        .as_ref()
                        .and_then(|c| c.read_validity.as_ref())
                        .is_none()
                {
                    return Err(SearchError::Protocol);
                }
            }
            hydration_outcome::Outcome::Unchanged(p) => {
                if item.known_validator.is_empty()
                    || p.validator != item.known_validator
                    || p.fields != item.fields
                    || p.cache
                        .as_ref()
                        .and_then(|c| c.read_validity.as_ref())
                        .is_none()
                {
                    return Err(SearchError::Protocol);
                }
            }
            hydration_outcome::Outcome::Unavailable(_)
            | hydration_outcome::Outcome::Retryable(_) => {}
        }
    }
    Ok(())
}
