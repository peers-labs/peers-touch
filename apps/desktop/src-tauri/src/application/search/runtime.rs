//! Native host binding for the portable read cache.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use prost::Message;
use search_core::cache::{Operation, ReadCache, ReadKey};
use search_core::model::wire::*;
use search_core::{CancelToken, SearchContributor, SearchError, SearchExecutionContext};
use sha2::{Digest, Sha256};

use super::messaging::{MessagingContributor, BINDING, SESSION_MS, SOURCE};
use crate::messaging::MessagingEngine;
use crate::state::AppState;

pub const READ_BUDGET: Duration = Duration::from_secs(5);

trait CachedReply: Message {
    fn cache_metadata(&self) -> Option<&CacheMetadata>;
    fn complete(&self) -> bool {
        true
    }
}

impl CachedReply for SourcePage {
    fn cache_metadata(&self) -> Option<&CacheMetadata> {
        self.cache.as_ref()
    }
    fn complete(&self) -> bool {
        self.coverage
            .as_ref()
            .is_some_and(|c| c.state == SourceState::Ready as i32)
    }
}

impl CachedReply for ResolvedResource {
    fn cache_metadata(&self) -> Option<&CacheMetadata> {
        self.cache.as_ref()
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
                format!("{account}\0{revision}\0{}", engine.incarnation()).as_bytes()
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

    pub fn check(&self) -> Result<(), SearchError> {
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

    /// Both identity changes and original-domain writes are fenced through
    /// the cache commit and the final IPC response construction.
    pub fn publish<T>(
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

    fn context(&self, operation: &Operation) -> SearchExecutionContext {
        SearchExecutionContext {
            partition: self.partition.clone(),
            read_scope: self.partition.clone(),
            binding_revision: BINDING.into(),
            deadline: operation.deadline,
            cancel: operation.cancel.clone(),
        }
    }

    fn key<M: Message>(&self, operation: &str, input: &M) -> ReadKey {
        ReadKey {
            partition: self.partition.clone(),
            source: SOURCE.into(),
            binding: BINDING.into(),
            read_scope: self.partition.clone(),
            dependency: self.source_revision.clone(),
            operation: operation.into(),
            semantic: input.encode_to_vec(),
        }
    }
}

#[derive(Default)]
pub struct SearchRuntime {
    pub cache: Arc<ReadCache>,
    sources: Mutex<HashMap<String, (String, Arc<dyn SearchContributor>)>>,
}

impl SearchRuntime {
    pub fn invalidate_window(&self, window: &str) {
        let prefix = format!("{window}\0");
        self.cache
            .invalidate(|key| key.partition.starts_with(&prefix));
        if let Ok(mut sources) = self.sources.lock() {
            sources.retain(|partition, _| !partition.starts_with(&prefix));
        }
    }

    fn source(&self, binding: &Binding) -> Result<Arc<dyn SearchContributor>, SearchError> {
        let _identity = binding
            .state
            .identity_transition
            .lock()
            .map_err(|_| SearchError::Cancelled)?;
        binding.check()?;
        let mut sources = self.sources.lock().map_err(|_| SearchError::Cancelled)?;
        if let Some((revision, source)) = sources.get(&binding.partition) {
            if revision == &binding.source_revision {
                return Ok(source.clone());
            }
        }
        self.cache.invalidate(|key| {
            key.partition == binding.partition
                && key.source == SOURCE
                && !key.operation.starts_with("hydrate")
                && key.dependency != binding.source_revision
        });
        let source = Arc::new(MessagingContributor::new(
            binding.engine.clone(),
            binding.source_revision.clone(),
            binding.state.search_cursors.clone(),
        )?);
        let mut registry = search_core::contributor::ContributorRegistry::default();
        registry.register(source)?;
        let source = registry.get(SOURCE)?;
        sources.insert(
            binding.partition.clone(),
            (binding.source_revision.clone(), source.clone()),
        );
        Ok(source)
    }

    fn read<M: CachedReply + Default + Send + 'static>(
        &self,
        binding: &Binding,
        key: ReadKey,
        refresh: bool,
        cancel: &CancelToken,
        run: impl FnOnce(SearchExecutionContext) -> Result<M, SearchError> + Send + 'static,
    ) -> Result<M, SearchError> {
        binding.check()?;
        let (subscription, operation) = self.cache.subscribe(key, refresh, READ_BUDGET)?;
        tracing::debug!(target: "search", source_read = operation.is_some(), refresh, "Search read");
        if let Some(operation) = operation {
            let binding = binding.clone();
            let ctx = binding.context(&operation);
            tauri::async_runtime::spawn_blocking(move || {
                let read = run(ctx).and_then(|value| {
                    binding.publish(|| {
                        let metadata = value.cache_metadata().ok_or(SearchError::Protocol)?;
                        let remaining = metadata
                            .content_fresh_until_unix_ms
                            .saturating_sub(super::messaging::now_ms()? as i64)
                            .max(0) as u64;
                        operation.commit(
                            value.encode_to_vec(),
                            Instant::now() + Duration::from_millis(remaining.min(SESSION_MS)),
                            metadata.no_store || !value.complete(),
                        )
                    })
                });
                if let Err(error) = read {
                    operation.fail(error);
                }
            });
        }
        let bytes = subscription.wait(cancel, Instant::now() + READ_BUDGET)?;
        M::decode(bytes.as_ref()).map_err(|_| SearchError::Protocol)
    }

    pub fn query(
        &self,
        binding: &Binding,
        mut input: QueryIntent,
        cancel: &CancelToken,
    ) -> Result<SearchResponse, SearchError> {
        let source = self.source(binding)?;
        if input.suggestions && input.text.trim().is_empty() {
            input.kind = SearchKind::Conversation as i32;
        }
        let refresh = input.refresh;
        input.refresh = false;
        input.text = input.text.trim().to_owned();
        let key = binding.key("query", &input);
        let page: SourcePage = self.read(binding, key, refresh, cancel, move |ctx| {
            tauri::async_runtime::block_on(source.query(&input, &ctx))
        })?;
        let now = super::messaging::now_ms()?;
        if page.expires_at_unix_ms <= now as i64 {
            return Err(SearchError::CursorExpired);
        }
        let references: Vec<_> = page
            .candidates
            .iter()
            .map(|c| c.resource.clone().ok_or(SearchError::Protocol))
            .collect::<Result<_, _>>()?;
        let items = self.hydrate(binding, references, refresh, cancel)?;
        let has_more = !page.next_cursor.is_empty();
        let expires_at_unix_ms = page
            .cache
            .as_ref()
            .map_or(page.expires_at_unix_ms, |metadata| {
                page.expires_at_unix_ms
                    .min(metadata.content_fresh_until_unix_ms)
            });
        Ok(SearchResponse {
            items,
            next_cursor: page.next_cursor,
            has_more,
            coverage: page.coverage.into_iter().collect(),
            expires_at_unix_ms,
            read_validity: page.cache.and_then(|c| c.read_validity),
            source_revision: binding.source_revision.clone(),
        })
    }

    /// All misses enter one original-domain batch; each resource has a shared
    /// operation and independent cache key, so another query can reuse it.
    fn hydrate(
        &self,
        binding: &Binding,
        references: Vec<ResourceRef>,
        refresh: bool,
        cancel: &CancelToken,
    ) -> Result<Vec<ResultItem>, SearchError> {
        let source = self.source(binding)?;
        let mut subscriptions = Vec::new();
        let mut leaders = Vec::new();
        let mut validators = HashMap::new();
        for (index, resource) in references.into_iter().enumerate() {
            let mut item = HydrationItem {
                item_id: index.to_string(),
                resource: Some(resource),
                fields: vec![ProjectionField::Result as i32],
                known_validator: String::new(),
            };
            // Batch item IDs identify replies, not reusable object reads.
            let mut canonical = item.clone();
            canonical.item_id.clear();
            let mut key = binding.key("hydrate", &canonical);
            // Current query candidates were read under this original-owner
            // snapshot. An unchanged projection can survive unrelated writes.
            key.dependency = canonical
                .resource
                .as_ref()
                .ok_or(SearchError::Protocol)?
                .content_revision
                .clone();
            if key.dependency.is_empty() {
                return Err(SearchError::Protocol);
            }
            if let Some(bytes) = self.cache.validator_payload(&key) {
                if let Ok(outcome) = HydrationOutcome::decode(bytes.as_ref()) {
                    if let Some(hydration_outcome::Outcome::Changed(projection)) = outcome.outcome {
                        if let Some(cache) = &projection.cache {
                            item.known_validator = cache.validator.clone();
                            validators.insert(item.item_id.clone(), projection);
                        }
                    }
                }
            }
            let (subscription, operation) = self.cache.subscribe(key, refresh, READ_BUDGET)?;
            subscriptions.push(subscription);
            if let Some(operation) = operation {
                leaders.push((item, operation));
            }
        }
        tracing::debug!(target: "search", source_reads = leaders.len(),
            resources = subscriptions.len(), refresh, "Search hydration");
        if !leaders.is_empty() {
            let binding = binding.clone();
            tauri::async_runtime::spawn_blocking(move || {
                // Batch transport has its own cancellation. Individual resource
                // subscribers can detach without cancelling other batch members.
                let ctx = SearchExecutionContext {
                    partition: binding.partition.clone(),
                    read_scope: binding.partition.clone(),
                    binding_revision: BINDING.into(),
                    deadline: Instant::now() + READ_BUDGET,
                    cancel: CancelToken::all(
                        leaders.iter().map(|(_, op)| op.cancel.clone()).collect(),
                    ),
                };
                let request = HydrationRequest {
                    items: leaders.iter().map(|(item, _)| item.clone()).collect(),
                    refresh,
                };
                let read = tauri::async_runtime::block_on(source.hydrate(&request, &ctx));
                match read {
                    Ok(reply) => {
                        let outcomes: HashMap<_, _> = reply
                            .outcomes
                            .into_iter()
                            .map(|o| (o.item_id.clone(), o))
                            .collect();
                        for (item, operation) in leaders {
                            let outcome = outcomes
                                .get(&item.item_id)
                                .cloned()
                                .ok_or(SearchError::Protocol)
                                .and_then(|mut outcome| {
                                    if let Some(hydration_outcome::Outcome::Unchanged(unchanged)) =
                                        &outcome.outcome
                                    {
                                        let mut projection = validators
                                            .get(&item.item_id)
                                            .cloned()
                                            .ok_or(SearchError::Protocol)?;
                                        if projection.cache.as_ref().map(|c| &c.validator)
                                            != Some(&unchanged.validator)
                                        {
                                            return Err(SearchError::Protocol);
                                        }
                                        projection.cache = unchanged.cache.clone();
                                        outcome.outcome =
                                            Some(hydration_outcome::Outcome::Changed(projection));
                                    }
                                    Ok(outcome)
                                });
                            let commit = outcome.and_then(|outcome| {
                                binding.publish(|| {
                                    let (fresh_until, no_store) = match &outcome.outcome {
                                        Some(hydration_outcome::Outcome::Changed(p)) => {
                                            let cache =
                                                p.cache.as_ref().ok_or(SearchError::Protocol)?;
                                            let remaining = cache
                                                .content_fresh_until_unix_ms
                                                .saturating_sub(super::messaging::now_ms()? as i64)
                                                .max(0)
                                                as u64;
                                            (
                                                Instant::now()
                                                    + Duration::from_millis(
                                                        remaining.min(SESSION_MS),
                                                    ),
                                                cache.no_store,
                                            )
                                        }
                                        _ => (Instant::now(), true),
                                    };
                                    operation.commit(outcome.encode_to_vec(), fresh_until, no_store)
                                })
                            });
                            if let Err(error) = commit {
                                operation.fail(error);
                            }
                        }
                    }
                    Err(error) => {
                        for (_, operation) in leaders {
                            operation.fail(error.clone());
                        }
                    }
                }
            });
        }
        let mut items = Vec::new();
        for subscription in subscriptions {
            let bytes = subscription.wait(cancel, Instant::now() + READ_BUDGET)?;
            let outcome =
                HydrationOutcome::decode(bytes.as_ref()).map_err(|_| SearchError::Protocol)?;
            match outcome.outcome {
                Some(hydration_outcome::Outcome::Changed(p)) => {
                    items.push(p.result.ok_or(SearchError::Protocol)?)
                }
                Some(hydration_outcome::Outcome::Unavailable(_)) => {}
                // A validator with no payload is not an authorized projection.
                _ => return Err(SearchError::Protocol),
            }
        }
        Ok(items)
    }

    pub fn resolve(
        &self,
        binding: &Binding,
        resource: ResourceRef,
        cancel: &CancelToken,
    ) -> Result<ResolvedResource, SearchError> {
        let source = self.source(binding)?;
        let key = binding.key("resolve", &resource);
        self.read(binding, key, false, cancel, move |ctx| {
            tauri::async_runtime::block_on(source.resolve(&resource, &ctx))
        })
    }
}
