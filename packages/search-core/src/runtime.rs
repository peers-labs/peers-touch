//! Portable read coordination. Hosts own scheduling and original-domain authority.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use prost::Message;

use crate::cache::{Operation, ReadCache, ReadKey};
use crate::contributor::{validate_hydration, validate_page, ContributorRegistry};
use crate::model::wire::*;
use crate::{CancelToken, SearchContributor, SearchError, SearchExecutionContext, SourceFuture};

pub const READ_BUDGET: Duration = Duration::from_secs(5);
const MAX_FRESHNESS: Duration = Duration::from_secs(5 * 60);

/// Native execution scheduling is supplied by the host, never by a contributor.
pub trait SearchExecutor: Default + Clone + Send + Sync + 'static {
    fn spawn(&self, job: Box<dyn FnOnce() + Send>);
    fn block_on<T: Send>(&self, future: SourceFuture<'_, T>) -> Result<T, SearchError>;
    fn observe_read(&self, source_read: bool, refresh: bool);
    fn observe_hydration(&self, source_reads: usize, resources: usize, refresh: bool);
}

/// A trusted identity/source snapshot. Publication must linearize against both
/// identity transitions and the original store's writes. Cache hits grant no read right.
pub trait SearchBinding: Clone + Send + Sync + 'static {
    fn partition(&self) -> &str;
    fn source_revision(&self) -> &str;
    fn source_id(&self) -> &str;
    fn binding_id(&self) -> &str;
    fn check(&self) -> Result<(), SearchError>;
    fn publish<T>(
        &self,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError>;
    fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError>;
}

pub fn now_ms() -> Result<u64, SearchError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis() as u64)
        .map_err(|_| SearchError::CursorExpired)
}

fn freshness(metadata: &CacheMetadata) -> Result<Instant, SearchError> {
    let remaining = metadata
        .content_fresh_until_unix_ms
        .saturating_sub(now_ms()? as i64)
        .max(0) as u64;
    Ok(Instant::now() + Duration::from_millis(remaining).min(MAX_FRESHNESS))
}

fn context<B: SearchBinding>(binding: &B, operation: &Operation) -> SearchExecutionContext {
    SearchExecutionContext {
        partition: binding.partition().into(),
        read_scope: binding.partition().into(),
        binding_revision: binding.binding_id().into(),
        deadline: operation.deadline,
        cancel: operation.cancel.clone(),
    }
}

fn key<B: SearchBinding, M: Message>(binding: &B, operation: &str, input: &M) -> ReadKey {
    ReadKey {
        partition: binding.partition().into(),
        source: binding.source_id().into(),
        binding: binding.binding_id().into(),
        read_scope: binding.partition().into(),
        dependency: binding.source_revision().into(),
        operation: operation.into(),
        semantic: input.encode_to_vec(),
    }
}

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

type SourceKey = (String, String, String);
type BoundSource = (String, Arc<dyn SearchContributor>);

pub struct SearchRuntime<E: SearchExecutor> {
    pub cache: Arc<ReadCache>,
    executor: E,
    sources: Mutex<HashMap<SourceKey, BoundSource>>,
}

impl<E: SearchExecutor> Default for SearchRuntime<E> {
    fn default() -> Self {
        Self {
            cache: Default::default(),
            executor: E::default(),
            sources: Default::default(),
        }
    }
}

impl<E: SearchExecutor> SearchRuntime<E> {
    pub fn invalidate_partitions(&self, matches: impl Fn(&str) -> bool) {
        self.cache.invalidate(|key| matches(&key.partition));
        if let Ok(mut sources) = self.sources.lock() {
            sources.retain(|(partition, _, _), _| !matches(partition));
        }
    }

    fn source<B: SearchBinding>(
        &self,
        binding: &B,
    ) -> Result<Arc<dyn SearchContributor>, SearchError> {
        let source_key = (
            binding.partition().into(),
            binding.source_id().into(),
            binding.binding_id().into(),
        );
        let cached = binding.publish(|| {
            let sources = self.sources.lock().map_err(|_| SearchError::Cancelled)?;
            Ok(sources
                .get(&source_key)
                .filter(|(revision, _)| revision == binding.source_revision())
                .map(|(_, source)| source.clone()))
        })?;
        if let Some(source) = cached {
            return Ok(source);
        }
        // Construct the adapter outside the publication critical section: its
        // descriptor may read the original store. The second guard rejects a
        // concurrent identity/source transition before admitting it.
        let mut registry = ContributorRegistry::default();
        registry.register(binding.contributor()?)?;
        let source = registry.get(binding.source_id())?;
        if source.descriptor().binding_id != binding.binding_id() {
            return Err(SearchError::Protocol);
        }
        binding.publish(|| {
            let mut sources = self.sources.lock().map_err(|_| SearchError::Cancelled)?;
            if let Some((revision, source)) = sources.get(&source_key) {
                if revision == binding.source_revision() {
                    return Ok(source.clone());
                }
            }
            self.cache.invalidate(|key| {
                key.partition == binding.partition()
                    && key.source == binding.source_id()
                    && !key.operation.starts_with("hydrate")
                    && key.dependency != binding.source_revision()
            });
            sources.insert(
                source_key,
                (binding.source_revision().into(), source.clone()),
            );
            Ok(source)
        })
    }

    fn read<B: SearchBinding, M: CachedReply + Default + Send + 'static>(
        &self,
        binding: &B,
        key: ReadKey,
        refresh: bool,
        cancel: &CancelToken,
        run: impl FnOnce(SearchExecutionContext) -> Result<M, SearchError> + Send + 'static,
    ) -> Result<M, SearchError> {
        binding.check()?;
        let (subscription, operation) = self.cache.subscribe(key, refresh, READ_BUDGET)?;
        self.executor.observe_read(operation.is_some(), refresh);
        if let Some(operation) = operation {
            let binding = binding.clone();
            let ctx = context(&binding, &operation);
            self.executor.spawn(Box::new(move || {
                let read = run(ctx).and_then(|value| {
                    binding.publish(|| {
                        let metadata = value.cache_metadata().ok_or(SearchError::Protocol)?;
                        operation.commit(
                            value.encode_to_vec(),
                            freshness(metadata)?,
                            metadata.no_store || !value.complete(),
                        )
                    })
                });
                if let Err(error) = read {
                    operation.fail(error);
                }
            }));
        }
        let bytes = subscription.wait(cancel, Instant::now() + READ_BUDGET)?;
        M::decode(bytes.as_ref()).map_err(|_| SearchError::Protocol)
    }

    pub fn query<B: SearchBinding>(
        &self,
        binding: &B,
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
        let read_key = key(binding, "query", &input);
        let executor = self.executor.clone();
        let page: SourcePage = self.read(binding, read_key, refresh, cancel, move |ctx| {
            let page = executor.block_on(source.query(&input, &ctx))?;
            validate_page(source.descriptor(), &input, &page)?;
            Ok(page)
        })?;
        if page.expires_at_unix_ms <= now_ms()? as i64 {
            return Err(SearchError::CursorExpired);
        }
        let references = page
            .candidates
            .iter()
            .map(|candidate| candidate.resource.clone().ok_or(SearchError::Protocol))
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
            read_validity: page.cache.and_then(|metadata| metadata.read_validity),
            source_revision: binding.source_revision().into(),
        })
    }

    /// All misses enter one original-domain batch. Resources retain independent
    /// shared operations, allowing other queries to reuse unchanged projections.
    fn hydrate<B: SearchBinding>(
        &self,
        binding: &B,
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
            let mut canonical = item.clone();
            canonical.item_id.clear();
            let mut read_key = key(binding, "hydrate", &canonical);
            read_key.dependency = canonical
                .resource
                .as_ref()
                .ok_or(SearchError::Protocol)?
                .content_revision
                .clone();
            if read_key.dependency.is_empty() {
                return Err(SearchError::Protocol);
            }
            if let Some(bytes) = self.cache.validator_payload(&read_key) {
                if let Ok(outcome) = HydrationOutcome::decode(bytes.as_ref()) {
                    if let Some(hydration_outcome::Outcome::Changed(projection)) = outcome.outcome {
                        if let Some(cache) = &projection.cache {
                            item.known_validator = cache.validator.clone();
                            validators.insert(item.item_id.clone(), projection);
                        }
                    }
                }
            }
            let (subscription, operation) = self.cache.subscribe(read_key, refresh, READ_BUDGET)?;
            subscriptions.push(subscription);
            if let Some(operation) = operation {
                leaders.push((item, operation));
            }
        }
        self.executor
            .observe_hydration(leaders.len(), subscriptions.len(), refresh);
        if !leaders.is_empty() {
            let binding = binding.clone();
            let executor = self.executor.clone();
            self.executor.spawn(Box::new(move || {
                let ctx = SearchExecutionContext {
                    partition: binding.partition().into(),
                    read_scope: binding.partition().into(),
                    binding_revision: binding.binding_id().into(),
                    deadline: Instant::now() + READ_BUDGET,
                    cancel: CancelToken::all(
                        leaders.iter().map(|(_, op)| op.cancel.clone()).collect(),
                    ),
                };
                let request = HydrationRequest {
                    items: leaders.iter().map(|(item, _)| item.clone()).collect(),
                    refresh,
                };
                let read = executor
                    .block_on(source.hydrate(&request, &ctx))
                    .and_then(|reply| {
                        validate_hydration(&request, &reply)?;
                        Ok(reply)
                    });
                match read {
                    Ok(reply) => {
                        let outcomes: HashMap<_, _> = reply
                            .outcomes
                            .into_iter()
                            .map(|outcome| (outcome.item_id.clone(), outcome))
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
                                        Some(hydration_outcome::Outcome::Changed(projection)) => {
                                            let cache = projection
                                                .cache
                                                .as_ref()
                                                .ok_or(SearchError::Protocol)?;
                                            (freshness(cache)?, cache.no_store)
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
            }));
        }
        let mut items = Vec::new();
        for subscription in subscriptions {
            let bytes = subscription.wait(cancel, Instant::now() + READ_BUDGET)?;
            let outcome =
                HydrationOutcome::decode(bytes.as_ref()).map_err(|_| SearchError::Protocol)?;
            match outcome.outcome {
                Some(hydration_outcome::Outcome::Changed(projection)) => {
                    items.push(projection.result.ok_or(SearchError::Protocol)?)
                }
                Some(hydration_outcome::Outcome::Unavailable(_)) => {}
                _ => return Err(SearchError::Protocol),
            }
        }
        Ok(items)
    }

    pub fn resolve<B: SearchBinding>(
        &self,
        binding: &B,
        resource: ResourceRef,
        cancel: &CancelToken,
    ) -> Result<ResolvedResource, SearchError> {
        let source = self.source(binding)?;
        let read_key = key(binding, "resolve", &resource);
        let executor = self.executor.clone();
        self.read(binding, read_key, false, cancel, move |ctx| {
            executor.block_on(source.resolve(&resource, &ctx))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::task::{Context, Poll, Wake, Waker};

    #[derive(Clone, Default)]
    struct Executor;
    struct ReadyWake;
    impl Wake for ReadyWake {
        fn wake(self: Arc<Self>) {}
    }

    impl SearchExecutor for Executor {
        fn spawn(&self, job: Box<dyn FnOnce() + Send>) {
            std::thread::spawn(job);
        }
        fn block_on<T: Send>(&self, mut future: SourceFuture<'_, T>) -> Result<T, SearchError> {
            let waker = Waker::from(Arc::new(ReadyWake));
            match future.as_mut().poll(&mut Context::from_waker(&waker)) {
                Poll::Ready(result) => result,
                Poll::Pending => panic!("test source must complete synchronously"),
            }
        }
        fn observe_read(&self, _: bool, _: bool) {}
        fn observe_hydration(&self, _: usize, _: usize, _: bool) {}
    }

    struct Source {
        descriptor: SearchContributorDescriptor,
        reads: AtomicUsize,
    }
    impl Source {
        fn new() -> Self {
            Self {
                descriptor: SearchContributorDescriptor {
                    source_id: "source".into(),
                    owning_module: "owner".into(),
                    authority_namespaces: vec!["station:one".into()],
                    kinds: vec![SearchKind::Message as i32],
                    binding_id: "binding".into(),
                    descriptor_revision: "current".into(),
                    supports_paging: true,
                    max_batch: 100,
                },
                reads: AtomicUsize::new(0),
            }
        }
    }
    impl SearchContributor for Source {
        fn descriptor(&self) -> &SearchContributorDescriptor {
            &self.descriptor
        }
        fn query<'a>(
            &'a self,
            _: &'a QueryIntent,
            _: &'a SearchExecutionContext,
        ) -> SourceFuture<'a, SourcePage> {
            Box::pin(async { Err(SearchError::InvalidQuery) })
        }
        fn hydrate<'a>(
            &'a self,
            _: &'a HydrationRequest,
            _: &'a SearchExecutionContext,
        ) -> SourceFuture<'a, HydrationReply> {
            Box::pin(async { Err(SearchError::Protocol) })
        }
        fn resolve<'a>(
            &'a self,
            resource: &'a ResourceRef,
            ctx: &'a SearchExecutionContext,
        ) -> SourceFuture<'a, ResolvedResource> {
            Box::pin(async move {
                self.reads.fetch_add(1, Ordering::SeqCst);
                Ok(ResolvedResource {
                    resource: Some(resource.clone()),
                    resolver_binding: "owner.open".into(),
                    cache: Some(CacheMetadata {
                        validator: "unchanged".into(),
                        source_revision: "one".into(),
                        content_fresh_until_unix_ms: now_ms()? as i64 + 60_000,
                        read_validity: Some(ReadValidity {
                            read_scope: ctx.read_scope.clone(),
                            policy_revision: "one".into(),
                            owner_check_required: true,
                            lease_until_unix_ms: 0,
                        }),
                        no_store: false,
                    }),
                })
            })
        }
    }
    #[derive(Clone)]
    struct Binding {
        authority: Arc<Mutex<bool>>,
        source: Arc<Source>,
        revoke_during_construction: Arc<AtomicBool>,
    }
    impl Binding {
        fn new() -> Self {
            Self {
                authority: Arc::new(Mutex::new(true)),
                source: Arc::new(Source::new()),
                revoke_during_construction: Default::default(),
            }
        }
    }
    impl SearchBinding for Binding {
        fn partition(&self) -> &str {
            "identity"
        }
        fn source_revision(&self) -> &str {
            "one"
        }
        fn source_id(&self) -> &str {
            "source"
        }
        fn binding_id(&self) -> &str {
            "binding"
        }
        fn check(&self) -> Result<(), SearchError> {
            if *self.authority.lock().unwrap() {
                Ok(())
            } else {
                Err(SearchError::Cancelled)
            }
        }
        fn publish<T>(
            &self,
            publish: impl FnOnce() -> Result<T, SearchError>,
        ) -> Result<T, SearchError> {
            let authority = self.authority.lock().unwrap();
            if !*authority {
                return Err(SearchError::Cancelled);
            }
            publish()
        }
        fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError> {
            // A nested Store lock would fail this assertion rather than hang.
            let mut authority = self
                .authority
                .try_lock()
                .expect("constructor outside Store guard");
            if self.revoke_during_construction.load(Ordering::SeqCst) {
                *authority = false;
            }
            Ok(self.source.clone())
        }
    }

    #[test]
    fn adapter_construction_is_outside_store_guard_and_rebinding_rejects_admission() {
        let runtime = SearchRuntime::<Executor>::default();
        let binding = Binding::new();
        binding
            .revoke_during_construction
            .store(true, Ordering::SeqCst);
        assert!(matches!(
            runtime.source(&binding),
            Err(SearchError::Cancelled)
        ));
        assert!(runtime.sources.lock().unwrap().is_empty());
    }

    #[test]
    fn warm_resolve_reuses_content_but_never_grants_revoked_authority() {
        let runtime = SearchRuntime::<Executor>::default();
        let binding = Binding::new();
        let resource = ResourceRef {
            authority_namespace: "station:one".into(),
            kind: "message".into(),
            id: "message".into(),
            content_revision: "one".into(),
            ..Default::default()
        };
        let cancel = CancelToken::new();
        let first = runtime
            .resolve(&binding, resource.clone(), &cancel)
            .unwrap();
        let second = runtime
            .resolve(&binding, resource.clone(), &cancel)
            .unwrap();
        assert_eq!(first, second);
        assert_eq!(binding.source.reads.load(Ordering::SeqCst), 1);
        *binding.authority.lock().unwrap() = false;
        assert_eq!(
            runtime.resolve(&binding, resource, &cancel),
            Err(SearchError::Cancelled)
        );
        assert_eq!(binding.source.reads.load(Ordering::SeqCst), 1);
        runtime.invalidate_partitions(|partition| partition == "identity");
        assert!(runtime.sources.lock().unwrap().is_empty());
    }
}
