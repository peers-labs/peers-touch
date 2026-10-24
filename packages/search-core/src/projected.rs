//! Contributor over original-owner projections. No storage, transport or domain policy.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};
use std::time::Duration;

use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::contributor::{
    namespace_allowed, narrow_intent, normalize_intent, validate_descriptor, validate_hydration,
    validate_page, validate_resource,
};
use crate::cursor::authenticated::AuthenticatedCursorCodec;
use crate::model::wire::*;
use crate::runtime::now_ms;
use crate::{ScoredDocument, SearchContributor, SearchError, SearchExecutionContext, SourceFuture};

const SESSION_MS: u64 = 300_000;

pub struct ProjectedPage {
    pub documents: Vec<ScoredDocument>,
    /// Original owner's last-scanned (timestamp, kind, id), including denied rows.
    pub next_before: Option<(i64, String, String)>,
}

pub trait ProjectedSearchReader: Send + Sync + 'static {
    fn revision(&self) -> Result<String, SearchError>;
    fn supports_suggestions(&self) -> bool {
        true
    }
    /// Must describe the just-completed read, not an invented permission lease.
    fn read_state(&self) -> Result<SourceReadState, SearchError>;
    /// The original source owns the presentation of its declared coverage.
    fn coverage_detail_key(&self, _state: &SourceReadState) -> &str {
        ""
    }
    fn query_documents(
        &self,
        input: &QueryIntent,
        ctx: &SearchExecutionContext,
        before: Option<(i64, &str, &str)>,
        limit: usize,
    ) -> Result<ProjectedPage, SearchError>;
    fn read_resources(
        &self,
        refs: &[ResourceRef],
        ctx: &SearchExecutionContext,
    ) -> Result<Vec<ScoredDocument>, SearchError>;
}

pub struct ProjectedContributor {
    reader: Arc<dyn ProjectedSearchReader>,
    descriptor: SearchContributorDescriptor,
    revision: String,
    resolver_binding: String,
    cursors: Arc<AuthenticatedCursorCodec>,
    // Pair the reader's operation and actual observation; do not race another read.
    read: Mutex<()>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Position {
    timestamp: i64,
    kind: String,
    id: String,
}

impl ProjectedContributor {
    pub fn new(
        reader: Arc<dyn ProjectedSearchReader>,
        descriptor: SearchContributorDescriptor,
        revision: String,
        resolver_binding: String,
        cursors: Arc<AuthenticatedCursorCodec>,
    ) -> Result<Self, SearchError> {
        validate_descriptor(&descriptor)?;
        if revision.is_empty() || resolver_binding.is_empty() {
            return Err(SearchError::Protocol);
        }
        Ok(Self {
            reader,
            descriptor,
            revision,
            resolver_binding,
            cursors,
            read: Mutex::new(()),
        })
    }

    fn lock(&self, ctx: &SearchExecutionContext) -> Result<MutexGuard<'_, ()>, SearchError> {
        loop {
            ctx.check()?;
            match self.read.try_lock() {
                Ok(guard) => return Ok(guard),
                Err(TryLockError::Poisoned(_)) => return Err(SearchError::Protocol),
                Err(TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(2)),
            }
        }
    }

    fn check(&self, ctx: &SearchExecutionContext) -> Result<(), SearchError> {
        ctx.check()?;
        if self.reader.revision()? != self.revision {
            return Err(SearchError::SourceChanged);
        }
        Ok(())
    }

    fn state(&self, ctx: &SearchExecutionContext) -> Result<SourceReadState, SearchError> {
        self.check(ctx)?;
        let state = self.reader.read_state()?;
        if state.source_id != self.descriptor.source_id
            || state.binding_id != self.descriptor.binding_id
            || state.read_scope != ctx.read_scope
            || state.source_revision.is_empty()
            || state.policy_revision.is_empty()
            || CoverageExtent::try_from(state.extent)
                .ok()
                .is_none_or(|e| e == CoverageExtent::Unspecified)
        {
            return Err(SearchError::Protocol);
        }
        if !matches!(
            SourceState::try_from(state.state),
            Ok(SourceState::Ready | SourceState::Partial | SourceState::Indexing)
        ) {
            return Err(SearchError::SourceUnavailable(
                self.descriptor.source_id.clone(),
            ));
        }
        Ok(state)
    }

    fn metadata(state: &SourceReadState, validator: String, fresh_until: u64) -> CacheMetadata {
        CacheMetadata {
            validator,
            source_revision: state.source_revision.clone(),
            content_fresh_until_unix_ms: if state.no_store {
                0
            } else {
                fresh_until as i64
            },
            read_validity: Some(ReadValidity {
                read_scope: state.read_scope.clone(),
                policy_revision: state.policy_revision.clone(),
                lease_until_unix_ms: 0,
                owner_check_required: true,
            }),
            no_store: state.no_store,
        }
    }

    fn result(&self, doc: ScoredDocument) -> Result<ResultItem, SearchError> {
        if validate_resource(&doc.resource)? as i32 != doc.kind as i32
            || !self.descriptor.kinds.contains(&(doc.kind as i32))
            || !namespace_allowed(&self.descriptor, &doc.resource.authority_namespace)
            || !doc.score.is_finite()
        {
            return Err(SearchError::Protocol);
        }
        let mut result = ResultItem {
            resource: Some(doc.resource),
            kind: doc.kind as i32,
            zone: doc.zone as i32,
            title: doc.title,
            snippet: doc.snippet,
            conversation_title: doc.conversation_title,
            author_ptid: doc.author_ptid,
            created_at_unix_ms: doc.created_at_unix_ms,
            score: doc.score,
            source_id: self.descriptor.source_id.clone(),
            read_validity: None,
        };
        if result
            .resource
            .as_ref()
            .unwrap()
            .content_revision
            .is_empty()
        {
            let revision = format!("{:x}", Sha256::digest(result.encode_to_vec()));
            result.resource.as_mut().unwrap().content_revision = revision;
        }
        Ok(result)
    }
}

impl SearchContributor for ProjectedContributor {
    fn descriptor(&self) -> &SearchContributorDescriptor {
        &self.descriptor
    }
    fn supports_suggestions(&self) -> bool {
        self.reader.supports_suggestions()
    }

    fn query<'a>(
        &'a self,
        input: &'a QueryIntent,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, SourcePage> {
        Box::pin(async move {
            if input.suggestions && !self.supports_suggestions() {
                return Err(SearchError::SourceUnavailable(
                    self.descriptor.source_id.clone(),
                ));
            }
            let _guard = self.lock(ctx)?;
            self.check(ctx)?;
            let input = normalize_intent(input.clone())?;
            let mut input =
                narrow_intent(&self.descriptor, &input).ok_or(SearchError::InvalidQuery)?;
            input.limit = input.limit.min(self.descriptor.max_batch).min(99);
            let mut canonical = input.clone();
            canonical.cursor.clear();
            canonical.refresh = false;
            let binding = format!(
                "{:x}",
                Sha256::digest(
                    serde_json::to_vec(&(
                        &ctx.partition,
                        &ctx.read_scope,
                        &ctx.binding_revision,
                        &self.revision,
                        &self.descriptor,
                        canonical.encode_to_vec(),
                    ))
                    .map_err(|_| SearchError::Protocol)?
                )
            );
            let now = now_ms()?;
            let (before, expiry) = if input.cursor.is_empty() {
                (None, now + SESSION_MS)
            } else {
                let (position, expiry) = self
                    .cursors
                    .decode_with_expiry::<Position>(&input.cursor, &binding, now)
                    .map_err(|_| SearchError::CursorExpired)?;
                (Some(position), expiry)
            };
            let before_ref = before
                .as_ref()
                .map(|p| (p.timestamp, p.kind.as_str(), p.id.as_str()));
            let page =
                self.reader
                    .query_documents(&input, ctx, before_ref, input.limit as usize)?;
            if page.documents.len() > input.limit as usize
                || (!self.descriptor.supports_paging && page.next_before.is_some())
            {
                return Err(SearchError::Protocol);
            }
            let next_cursor = if let Some((timestamp, kind, id)) = page.next_before {
                if kind.is_empty()
                    || id.is_empty()
                    || before
                        .as_ref()
                        .is_some_and(|p| (p.timestamp, &p.kind, &p.id) == (timestamp, &kind, &id))
                {
                    return Err(SearchError::Protocol);
                }
                self.cursors
                    .encode_until(
                        Position {
                            timestamp,
                            kind,
                            id,
                        },
                        &binding,
                        expiry,
                    )
                    .map_err(|_| SearchError::CursorExpired)?
            } else {
                String::new()
            };
            let state = self.state(ctx)?;
            let candidates = page
                .documents
                .into_iter()
                .enumerate()
                .map(|(index, doc)| {
                    Ok(SourceCandidate {
                        resource: self.result(doc)?.resource,
                        source_rank: (index + 1) as f64,
                    })
                })
                .collect::<Result<Vec<_>, SearchError>>()?;
            let fresh_until = if candidates.is_empty() {
                now + 15_000
            } else {
                expiry
            };
            let page = SourcePage {
                candidates,
                next_cursor,
                expires_at_unix_ms: expiry as i64,
                coverage: Some(SourceCoverage {
                    source_id: state.source_id.clone(),
                    state: state.state,
                    extent: state.extent,
                    detail_key: self.reader.coverage_detail_key(&state).into(),
                }),
                cache: Some(Self::metadata(
                    &state,
                    state.source_revision.clone(),
                    fresh_until,
                )),
            };
            validate_page(&self.descriptor, &input, &page)?;
            Ok(page)
        })
    }

    fn hydrate<'a>(
        &'a self,
        input: &'a HydrationRequest,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, HydrationReply> {
        Box::pin(async move {
            let _guard = self.lock(ctx)?;
            self.check(ctx)?;
            if input.items.len() > self.descriptor.max_batch as usize
                || input
                    .items
                    .iter()
                    .any(|i| i.fields != [ProjectionField::Result as i32])
            {
                return Err(SearchError::Protocol);
            }
            let refs = input
                .items
                .iter()
                .map(|i| {
                    let resource = i.resource.clone().ok_or(SearchError::Protocol)?;
                    let kind = validate_resource(&resource)?;
                    if !self.descriptor.kinds.contains(&(kind as i32))
                        || !namespace_allowed(&self.descriptor, &resource.authority_namespace)
                    {
                        return Err(SearchError::Protocol);
                    }
                    Ok(resource)
                })
                .collect::<Result<Vec<_>, SearchError>>()?;
            let docs = self.reader.read_resources(&refs, ctx)?;
            let state = self.state(ctx)?;
            let mut results = HashMap::new();
            for doc in docs {
                let result = self.result(doc)?;
                let reference = result.resource.as_ref().unwrap();
                if !refs
                    .iter()
                    .any(|r| r.fusion_key() == reference.fusion_key())
                    || results.insert(reference.fusion_key(), result).is_some()
                {
                    return Err(SearchError::Protocol);
                }
            }
            let expiry = now_ms()? + SESSION_MS;
            let outcomes = input
                .items
                .iter()
                .map(|item| {
                    let requested = item.resource.as_ref().ok_or(SearchError::Protocol)?;
                    let outcome = if let Some(result) =
                        results.get(&requested.fusion_key()).filter(|r| {
                            requested.content_revision.is_empty()
                                || requested.content_revision
                                    == r.resource.as_ref().unwrap().content_revision
                        }) {
                        let mut result = result.clone();
                        let validator = result.resource.as_ref().unwrap().content_revision.clone();
                        let cache = Self::metadata(&state, validator.clone(), expiry);
                        result.read_validity = cache.read_validity.clone();
                        if !state.no_store && item.known_validator == validator {
                            hydration_outcome::Outcome::Unchanged(UnchangedProjection {
                                validator,
                                fields: item.fields.clone(),
                                cache: Some(cache),
                            })
                        } else {
                            hydration_outcome::Outcome::Changed(AuthorizedProjection {
                                result: Some(result),
                                fields: item.fields.clone(),
                                cache: Some(cache),
                            })
                        }
                    } else {
                        hydration_outcome::Outcome::Unavailable(UnavailableResource {})
                    };
                    Ok(HydrationOutcome {
                        item_id: item.item_id.clone(),
                        outcome: Some(outcome),
                    })
                })
                .collect::<Result<Vec<_>, SearchError>>()?;
            let reply = HydrationReply { outcomes };
            validate_hydration(input, &reply)?;
            Ok(reply)
        })
    }

    fn resolve<'a>(
        &'a self,
        resource: &'a ResourceRef,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, ResolvedResource> {
        Box::pin(async move {
            let reply = self
                .hydrate(
                    &HydrationRequest {
                        items: vec![HydrationItem {
                            item_id: "resolve".into(),
                            resource: Some(resource.clone()),
                            fields: vec![ProjectionField::Result as i32],
                            known_validator: String::new(),
                        }],
                        refresh: true,
                    },
                    ctx,
                )
                .await?;
            match reply.outcomes.into_iter().next().and_then(|o| o.outcome) {
                Some(hydration_outcome::Outcome::Changed(projection)) => Ok(ResolvedResource {
                    resource: projection.result.and_then(|r| r.resource),
                    resolver_binding: self.resolver_binding.clone(),
                    cache: projection.cache,
                }),
                _ => Err(SearchError::ResourceUnavailable),
            }
        })
    }
}
