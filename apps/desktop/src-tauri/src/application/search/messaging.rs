//! Adapter over Messaging truth; no transport, duplicated index or read policy.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use prost::Message;
use search_core::cursor::authenticated::AuthenticatedCursorCodec;
use search_core::model::wire::*;
use search_core::{
    ScoredDocument, SearchContributor, SearchError, SearchExecutionContext, SourceFuture,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::messaging::MessagingEngine;

pub const SOURCE: &str = "device.messaging";
pub const BINDING: &str = "messaging.device.read";
pub const SESSION_MS: u64 = 5 * 60 * 1000;

pub fn now_ms() -> Result<u64, SearchError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|t| t.as_millis() as u64)
        .map_err(|_| SearchError::CursorExpired)
}

pub fn result(mut doc: ScoredDocument) -> ResultItem {
    let mut item = ResultItem {
        resource: Some(doc.resource.clone()),
        kind: doc.kind as i32,
        zone: doc.zone as i32,
        title: doc.title,
        snippet: doc.snippet,
        conversation_title: doc.conversation_title,
        author_ptid: doc.author_ptid,
        created_at_unix_ms: doc.created_at_unix_ms,
        score: doc.score,
    };
    doc.resource.content_revision = hex::encode(Sha256::digest(item.encode_to_vec()));
    item.resource = Some(doc.resource);
    item
}

pub struct MessagingContributor {
    pub engine: Arc<MessagingEngine>,
    descriptor: SearchContributorDescriptor,
    pub revision: String,
    cursors: Arc<AuthenticatedCursorCodec>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MessageCursor {
    timestamp: i64,
    message_id: String,
    conversation_id: String,
}

impl MessagingContributor {
    pub fn new(
        engine: Arc<MessagingEngine>,
        revision: String,
        cursors: Arc<AuthenticatedCursorCodec>,
    ) -> Result<Self, SearchError> {
        let namespaces = engine
            .search_authorities()
            .map_err(SearchError::SourceUnavailable)?;
        Ok(Self {
            engine,
            revision,
            cursors,
            descriptor: SearchContributorDescriptor {
                source_id: SOURCE.into(),
                owning_module: "messaging".into(),
                authority_namespaces: namespaces,
                kinds: vec![SearchKind::Message as i32, SearchKind::Conversation as i32],
                binding_id: BINDING.into(),
                descriptor_revision: "device-read".into(),
                supports_paging: true,
                max_batch: 100,
            },
        })
    }

    fn check(&self, ctx: &SearchExecutionContext) -> Result<(), SearchError> {
        ctx.check()?;
        if self
            .engine
            .search_revision()
            .map_err(SearchError::SourceUnavailable)?
            != self.revision
        {
            return Err(SearchError::SourceChanged);
        }
        Ok(())
    }

    pub fn metadata(
        &self,
        ctx: &SearchExecutionContext,
        validator: String,
        expiry: u64,
    ) -> CacheMetadata {
        CacheMetadata {
            validator,
            source_revision: self.revision.clone(),
            content_fresh_until_unix_ms: expiry as i64,
            read_validity: Some(ReadValidity {
                read_scope: ctx.read_scope.clone(),
                policy_revision: self.revision.clone(),
                owner_check_required: true,
                lease_until_unix_ms: 0,
            }),
            no_store: false,
        }
    }
}

impl SearchContributor for MessagingContributor {
    fn descriptor(&self) -> &SearchContributorDescriptor {
        &self.descriptor
    }

    fn query<'a>(
        &'a self,
        input: &'a QueryIntent,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, SourcePage> {
        Box::pin(async move {
            self.check(ctx)?;
            if input.scope != SearchScope::Device as i32 {
                return Err(SearchError::OutsideDomain);
            }
            let query = input.text.trim();
            if (query.is_empty() && !input.suggestions)
                || query.chars().count() > search_core::MAX_QUERY_CHARS
                || input.limit == 0
                || input.limit > 100
            {
                return Err(SearchError::InvalidQuery);
            }
            let kind = SearchKind::try_from(input.kind).map_err(|_| SearchError::InvalidQuery)?;
            if !matches!(
                kind,
                SearchKind::Message | SearchKind::Conversation | SearchKind::Unspecified
            ) || (kind == SearchKind::Unspecified && !input.suggestions)
                || (kind == SearchKind::Conversation && !input.cursor.is_empty())
            {
                return Err(SearchError::InvalidQuery);
            }
            let now = now_ms()?;
            let mut canonical = input.clone();
            canonical.refresh = false;
            canonical.cursor.clear();
            let binding = hex::encode(Sha256::digest(
                [
                    ctx.partition.as_bytes(),
                    ctx.read_scope.as_bytes(),
                    self.revision.as_bytes(),
                    canonical.encode_to_vec().as_slice(),
                ]
                .concat(),
            ));
            let (cursor, expires) = if input.cursor.is_empty() {
                (None, now + SESSION_MS)
            } else {
                let (cursor, expiry) = self
                    .cursors
                    .decode_with_expiry::<MessageCursor>(&input.cursor, &binding, now)
                    .map_err(|_| SearchError::CursorExpired)?;
                (Some(cursor), expiry)
            };
            let limit = input.limit as usize;
            let mut documents = Vec::new();
            // Check deadlines during traversal, without re-entering the Store mutex.
            let check = || ctx.check().map_err(|e| e.to_string());
            if kind != SearchKind::Message {
                documents = self
                    .engine
                    .suggest_conversations(
                        query,
                        if input.suggestions {
                            limit.min(5)
                        } else {
                            limit
                        },
                        &check,
                    )
                    .map_err(SearchError::SourceUnavailable)?;
            }
            let mut has_more = false;
            let mut next_cursor = String::new();
            if kind != SearchKind::Conversation && !query.is_empty() {
                search_core::build_match_expression(query)
                    .map_err(|_| SearchError::InvalidQuery)?;
                let message_limit = limit.saturating_sub(documents.len());
                if message_limit > 0 {
                    let before = cursor.as_ref().map(|c| {
                        (
                            c.timestamp,
                            c.message_id.as_str(),
                            c.conversation_id.as_str(),
                        )
                    });
                    let mut messages = self
                        .engine
                        .search_device_documents(query, before, message_limit + 1, &check)
                        .map_err(SearchError::SourceUnavailable)?;
                    has_more = messages.len() > message_limit;
                    messages.truncate(message_limit);
                    if has_more {
                        let last = messages.last().ok_or(SearchError::CursorExpired)?;
                        next_cursor = self
                            .cursors
                            .encode_until(
                                MessageCursor {
                                    timestamp: last.created_at_unix_ms,
                                    message_id: last.resource.message_id.clone(),
                                    conversation_id: last.resource.conversation_id.clone(),
                                },
                                &binding,
                                expires,
                            )
                            .map_err(|_| SearchError::CursorExpired)?;
                    }
                    documents.extend(messages);
                }
            }
            self.check(ctx)?;
            let fresh_until = if documents.is_empty() {
                now + 15_000
            } else {
                expires
            };
            let page = SourcePage {
                candidates: documents
                    .into_iter()
                    .enumerate()
                    .map(|(i, d)| SourceCandidate {
                        resource: result(d).resource,
                        source_rank: (i + 1) as f64,
                    })
                    .collect(),
                next_cursor: if has_more && !input.suggestions {
                    next_cursor
                } else {
                    String::new()
                },
                coverage: Some(SourceCoverage {
                    source_id: SOURCE.into(),
                    state: SourceState::Ready as i32,
                    detail_key: "search.coverage.device_ready".into(),
                }),
                cache: Some(self.metadata(ctx, self.revision.clone(), fresh_until)),
                expires_at_unix_ms: expires as i64,
            };
            search_core::contributor::validate_page(&self.descriptor, input, &page)?;
            Ok(page)
        })
    }

    fn hydrate<'a>(
        &'a self,
        input: &'a HydrationRequest,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, HydrationReply> {
        Box::pin(async move {
            self.check(ctx)?;
            if input.items.len() > self.descriptor.max_batch as usize
                || input
                    .items
                    .iter()
                    .any(|i| i.fields != [ProjectionField::Result as i32])
            {
                return Err(SearchError::Protocol);
            }
            let refs: Vec<_> = input
                .items
                .iter()
                .map(|i| i.resource.clone().ok_or(SearchError::Protocol))
                .collect::<Result<_, _>>()?;
            if refs.iter().any(|r| {
                !r.target_page.is_empty()
                    || !self
                        .descriptor
                        .authority_namespaces
                        .contains(&r.authority_namespace)
                    || r.anchor
                        .as_ref()
                        .is_some_and(|a| a.kind != "message" || a.id != r.message_id)
                    || (r.kind == "message" && r.id != r.message_id)
            }) {
                return Err(SearchError::Protocol);
            }
            let docs = self
                .engine
                .search_read_resources(&refs, &|| ctx.check().map_err(|e| e.to_string()))
                .map_err(SearchError::SourceUnavailable)?;
            let results: HashMap<_, _> = docs
                .into_iter()
                .map(result)
                .map(|r| (r.resource.as_ref().unwrap().fusion_key(), r))
                .collect();
            self.check(ctx)?;
            let expiry = now_ms()? + SESSION_MS;
            let mut outcomes = Vec::new();
            for item in &input.items {
                let reference = item.resource.as_ref().ok_or(SearchError::Protocol)?;
                let outcome = match results.get(&reference.fusion_key()) {
                    Some(r)
                        if reference.content_revision.is_empty()
                            || reference.content_revision
                                == r.resource.as_ref().unwrap().content_revision =>
                    {
                        let validator = r.resource.as_ref().unwrap().content_revision.clone();
                        let cache = Some(self.metadata(ctx, validator.clone(), expiry));
                        if item.known_validator == validator {
                            hydration_outcome::Outcome::Unchanged(UnchangedProjection {
                                validator,
                                fields: item.fields.clone(),
                                cache,
                            })
                        } else {
                            hydration_outcome::Outcome::Changed(AuthorizedProjection {
                                result: Some(r.clone()),
                                fields: item.fields.clone(),
                                cache,
                            })
                        }
                    }
                    _ => hydration_outcome::Outcome::Unavailable(UnavailableResource {}),
                };
                outcomes.push(HydrationOutcome {
                    item_id: item.item_id.clone(),
                    outcome: Some(outcome),
                });
            }
            let reply = HydrationReply { outcomes };
            search_core::contributor::validate_hydration(input, &reply)?;
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
                        refresh: false,
                    },
                    ctx,
                )
                .await?;
            match reply.outcomes.into_iter().next().and_then(|o| o.outcome) {
                Some(hydration_outcome::Outcome::Changed(p)) => Ok(ResolvedResource {
                    resource: p.result.and_then(|r| r.resource),
                    resolver_binding: "messaging.device.open".into(),
                    cache: p.cache,
                }),
                _ => Err(SearchError::ResourceUnavailable),
            }
        })
    }
}
