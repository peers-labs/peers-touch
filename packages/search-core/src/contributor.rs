//! Declaration and batch-reply conformance for every contributor.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::model::wire::*;
use crate::{SearchContributor, SearchError};

/// Trusted declaration roots, never a wildcard or candidate-driven grant.
pub fn namespace_allowed(descriptor: &SearchContributorDescriptor, namespace: &str) -> bool {
    descriptor.authority_namespaces.iter().any(|root| {
        namespace == root
            || namespace
                .strip_prefix(root)
                .is_some_and(|suffix| suffix.starts_with(':') && suffix.len() > 1)
    })
}

pub fn resource_kind(resource: &ResourceRef) -> Result<SearchKind, SearchError> {
    Ok(match resource.kind.as_str() {
        "message" => SearchKind::Message,
        "conversation" => SearchKind::Conversation,
        "person" => SearchKind::Person,
        "social-post" => SearchKind::SocialPost,
        "social-comment" => SearchKind::SocialComment,
        "agent" => SearchKind::Agent,
        "knowledge" => SearchKind::Knowledge,
        "attachment" => SearchKind::Attachment,
        "function" => SearchKind::Function,
        _ => return Err(SearchError::OutsideDomain),
    })
}

/// Navigation relationships never change the object's fusion identity.
pub fn validate_resource(resource: &ResourceRef) -> Result<SearchKind, SearchError> {
    let kind = resource_kind(resource)?;
    if resource.id.is_empty() || resource.authority_namespace.is_empty() {
        return Err(SearchError::Protocol);
    }
    if kind != SearchKind::Function && !resource.target_page.is_empty() {
        return Err(SearchError::Protocol);
    }
    if kind == SearchKind::SocialComment {
        let parent = resource.parent.as_deref().ok_or(SearchError::Protocol)?;
        if parent.kind != "social-post"
            || parent.id.is_empty()
            || parent.authority_namespace != resource.authority_namespace
            || parent.parent.is_some()
            || !parent.target_page.is_empty()
            || !parent.message_id.is_empty()
            || !parent.conversation_id.is_empty()
            || resource
                .anchor
                .as_ref()
                .is_none_or(|a| a.kind != "comment" || a.id != resource.id)
        {
            return Err(SearchError::Protocol);
        }
    } else if resource.parent.is_some() {
        return Err(SearchError::Protocol);
    }
    if matches!(kind, SearchKind::SocialPost | SearchKind::SocialComment)
        && (!resource.message_id.is_empty() || !resource.conversation_id.is_empty())
    {
        return Err(SearchError::Protocol);
    }
    if kind == SearchKind::Message
        && (resource.id != resource.message_id
            || resource.conversation_id.is_empty()
            || resource
                .anchor
                .as_ref()
                .is_some_and(|a| a.kind != "message" || a.id != resource.id))
    {
        return Err(SearchError::Protocol);
    }
    Ok(kind)
}

pub fn same_resource(a: &ResourceRef, b: &ResourceRef) -> bool {
    let mut a = a.clone();
    let mut b = b.clone();
    a.content_revision.clear();
    b.content_revision.clear();
    a == b
}

/// Normalize generated selectors without granting any new scope.
pub fn normalize_intent(mut intent: QueryIntent) -> Result<QueryIntent, SearchError> {
    intent.text = intent.text.trim().into();
    intent.kinds.sort_unstable();
    intent.kinds.dedup();
    intent.scopes.sort_unstable();
    intent.scopes.dedup();
    if intent.text.chars().count() > crate::MAX_QUERY_CHARS
        || intent.cursor.len() > 4096
        || intent.conversation_id.len() > 256
        || intent.locale.len() > 64
        || (!intent.suggestions && intent.text.is_empty())
        || (!intent.text.is_empty() && crate::tokenize(&intent.text).is_empty())
        || intent.limit > 100
        || intent.kinds.iter().any(|k| {
            SearchKind::try_from(*k)
                .ok()
                .is_none_or(|k| k == SearchKind::Unspecified)
        })
        || intent.scopes.is_empty()
        || intent.scopes.iter().any(|s| {
            !matches!(
                SearchScope::try_from(*s),
                Ok(SearchScope::Device | SearchScope::Station)
            )
        })
        || (intent.suggestions && intent.scopes != [SearchScope::Device as i32])
    {
        return Err(SearchError::InvalidQuery);
    }
    intent.limit = if intent.limit == 0 { 20 } else { intent.limit };
    Ok(intent)
}

pub fn narrow_intent(d: &SearchContributorDescriptor, input: &QueryIntent) -> Option<QueryIntent> {
    let mut narrowed = input.clone();
    narrowed.kinds = d
        .kinds
        .iter()
        .copied()
        .filter(|k| input.kinds.is_empty() || input.kinds.contains(k))
        .collect();
    if input.attachment_names_only {
        narrowed.kinds.retain(|k| *k == SearchKind::Message as i32);
    } else if !input.conversation_id.is_empty() {
        narrowed.kinds.retain(|k| {
            matches!(
                SearchKind::try_from(*k),
                Ok(SearchKind::Message | SearchKind::Conversation)
            )
        });
    }
    narrowed.scopes.retain(|s| d.scopes.contains(s));
    if narrowed.kinds.is_empty() || narrowed.scopes.is_empty() {
        return None;
    }
    Some(narrowed)
}

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
        || page.candidates.len() > descriptor.max_batch as usize
        || page.coverage.as_ref().map(|c| &c.source_id) != Some(&descriptor.source_id)
        || (!descriptor.supports_paging && !page.next_cursor.is_empty())
        || intent.scopes.is_empty()
        || intent.scopes.iter().any(|s| !descriptor.scopes.contains(s))
        || page.coverage.as_ref().is_none_or(|c| {
            SourceState::try_from(c.state)
                .ok()
                .is_none_or(|s| s == SourceState::Unspecified)
                || CoverageExtent::try_from(c.extent)
                    .ok()
                    .is_none_or(|e| e == CoverageExtent::Unspecified)
        })
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
        let kind = validate_resource(resource)?;
        if resource.id.is_empty()
            || !descriptor.kinds.contains(&(kind as i32))
            || (!intent.kinds.is_empty() && !intent.kinds.contains(&(kind as i32)))
            || (!intent.conversation_id.is_empty()
                && resource.conversation_id != intent.conversation_id)
            || (intent.attachment_names_only && kind != SearchKind::Message)
            || resource.content_revision.is_empty()
            || !namespace_allowed(descriptor, &resource.authority_namespace)
            || !candidate.source_rank.is_finite()
            || candidate.source_rank <= 0.0
            || !seen.insert(resource.fusion_key())
        {
            return Err(SearchError::Protocol);
        }
    }
    Ok(())
}

pub fn validate_descriptor(d: &SearchContributorDescriptor) -> Result<(), SearchError> {
    if d.source_id.is_empty()
        || d.owning_module.is_empty()
        || d.binding_id.is_empty()
        || d.descriptor_revision.is_empty()
        || d.authority_namespaces.is_empty()
        || d.authority_namespaces
            .iter()
            .any(|n| n.is_empty() || n.contains('*'))
        || d.max_batch == 0
        || d.max_batch > 100
        || d.kinds.is_empty()
        || d.kinds.iter().collect::<HashSet<_>>().len() != d.kinds.len()
        || d.scopes.is_empty()
        || d.scopes.iter().collect::<HashSet<_>>().len() != d.scopes.len()
        || d.scopes.iter().any(|s| {
            !matches!(
                SearchScope::try_from(*s),
                Ok(SearchScope::Device | SearchScope::Station)
            )
        })
        || d.kinds.iter().any(|k| {
            SearchKind::try_from(*k)
                .ok()
                .is_none_or(|k| k == SearchKind::Unspecified)
        })
    {
        return Err(SearchError::Protocol);
    }
    Ok(())
}

impl ContributorRegistry {
    /// The host resolves and authenticates the binding before registration.
    /// A descriptor does not grant access or make an unavailable source ready.
    pub fn register(&mut self, source: Arc<dyn SearchContributor>) -> Result<(), SearchError> {
        let d = source.descriptor();
        validate_descriptor(d)?;
        if self.sources.contains_key(&d.source_id) {
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
                if !same_resource(actual, requested)
                    || validate_resource(actual)? as i32 != p.result.as_ref().unwrap().kind
                    || (!requested.content_revision.is_empty()
                        && actual.content_revision != requested.content_revision)
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
