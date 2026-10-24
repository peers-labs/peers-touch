//! Portable read coordination. Hosts own scheduling and original-domain authority.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use prost::Message;

use crate::cache::{Operation, ReadCache, ReadKey};
use crate::contributor::{validate_hydration, validate_page, ContributorRegistry};
use crate::model::wire::*;
use crate::session::SessionStore;
use crate::{CancelToken, SearchContributor, SearchError, SearchExecutionContext, SourceFuture};

pub const READ_BUDGET: Duration = Duration::from_secs(5);
const MAX_FRESHNESS: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadAuthority {
    LocalSnapshot,
    RemoteOwner,
}

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

    fn read_authority(&self) -> ReadAuthority {
        ReadAuthority::LocalSnapshot
    }

    /// Override for independent read scopes, policy revisions and coverage.
    /// Called outside publication locks; the host authenticates this snapshot.
    fn read_state(&self) -> Result<SourceReadState, SearchError> {
        self.check()?;
        Ok(SourceReadState {
            source_id: self.source_id().into(),
            binding_id: self.binding_id().into(),
            source_revision: self.source_revision().into(),
            read_scope: self.partition().into(),
            policy_revision: self.source_revision().into(),
            state: SourceState::Ready as i32,
            extent: CoverageExtent::DeclaredScope as i32,
            no_store: false,
        })
    }

    /// A composite host must atomically validate this entire vector with its
    /// authentication/source owners, then invoke the closure under that guard.
    /// Never implement this by nesting per-source locks that share an owner.
    fn publish_sources<T>(
        &self,
        sources: &[SourceReadState],
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        if sources.is_empty() {
            return self.publish(publish);
        }
        if sources.len() != 1
            || sources[0].source_id != self.source_id()
            || sources[0].binding_id != self.binding_id()
            || (self.read_authority() == ReadAuthority::LocalSnapshot
                && sources[0].source_revision != self.source_revision())
            || (self.read_authority() == ReadAuthority::RemoteOwner
                && (!sources[0].no_store || sources[0].read_scope != self.read_state()?.read_scope))
        {
            return Err(SearchError::Protocol);
        }
        self.publish(publish)
    }
}

pub fn now_ms() -> Result<u64, SearchError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis() as u64)
        .map_err(|_| SearchError::CursorExpired)
}

pub(crate) fn freshness(metadata: &CacheMetadata) -> Result<Instant, SearchError> {
    let validity = metadata
        .read_validity
        .as_ref()
        .ok_or(SearchError::Protocol)?;
    let until = if validity.owner_check_required {
        metadata.content_fresh_until_unix_ms
    } else {
        metadata
            .content_fresh_until_unix_ms
            .min(validity.lease_until_unix_ms)
    };
    let remaining = until.saturating_sub(now_ms()? as i64).max(0) as u64;
    Ok(Instant::now() + Duration::from_millis(remaining).min(MAX_FRESHNESS))
}

fn context<B: SearchBinding>(
    binding: &B,
    operation: &Operation,
    state: &SourceReadState,
) -> Result<SearchExecutionContext, SearchError> {
    Ok(SearchExecutionContext {
        partition: binding.partition().into(),
        read_scope: state.read_scope.clone(),
        binding_revision: binding.source_revision().into(),
        deadline: operation.deadline,
        cancel: operation.cancel.clone(),
    })
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

pub(crate) struct Hydrated {
    pub items: Vec<ResultItem>,
    pub state: SourceReadState,
}

pub struct SearchRuntime<E: SearchExecutor> {
    pub cache: Arc<ReadCache>,
    pub(crate) executor: E,
    sources: Arc<Mutex<HashMap<SourceKey, BoundSource>>>,
    pub(crate) sessions: Arc<SessionStore>,
}

impl<E: SearchExecutor> Clone for SearchRuntime<E> {
    fn clone(&self) -> Self {
        Self {
            cache: self.cache.clone(),
            executor: self.executor.clone(),
            sources: self.sources.clone(),
            sessions: self.sessions.clone(),
        }
    }
}

impl<E: SearchExecutor> Default for SearchRuntime<E> {
    fn default() -> Self {
        Self {
            cache: Default::default(),
            executor: E::default(),
            sources: Default::default(),
            sessions: Default::default(),
        }
    }
}

impl<E: SearchExecutor> SearchRuntime<E> {
    pub fn invalidate_partitions(&self, matches: impl Fn(&str) -> bool) {
        self.cache.invalidate(|key| matches(&key.partition));
        self.sessions.invalidate(&matches);
        if let Ok(mut sources) = self.sources.lock() {
            sources.retain(|(partition, _, _), _| !matches(partition));
        }
    }

    pub(crate) fn source<B: SearchBinding>(
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
        deadline: Instant,
        run: impl FnOnce(SearchExecutionContext) -> Result<M, SearchError> + Send + 'static,
    ) -> Result<M, SearchError> {
        binding.check()?;
        let state = binding.read_state()?;
        let mut key = key;
        key.read_scope = state.read_scope.clone();
        key.binding
            .push_str(&format!(":{:?}", state.policy_revision));
        let (subscription, operation) = self.cache.subscribe(
            key,
            refresh || state.no_store,
            deadline.saturating_duration_since(Instant::now()),
        )?;
        self.executor.observe_read(operation.is_some(), refresh);
        if let Some(operation) = operation {
            let binding = binding.clone();
            let ctx = context(&binding, &operation, &state)?;
            let state = state.clone();
            self.executor.spawn(Box::new(move || {
                let read = run(ctx).and_then(|value| {
                    binding.publish(|| {
                        let metadata = value.cache_metadata().ok_or(SearchError::Protocol)?;
                        validate_metadata(binding.read_authority(), &state, metadata)?;
                        operation.commit(
                            value.encode_to_vec(),
                            freshness(metadata)?,
                            metadata.no_store || state.no_store || !value.complete(),
                        )
                    })
                });
                if let Err(error) = read {
                    operation.fail(error);
                }
            }));
        }
        let bytes = subscription.wait(cancel, deadline)?;
        binding.publish(|| {
            cancel.check()?;
            let value = M::decode(bytes.as_ref()).map_err(|_| SearchError::Protocol)?;
            validate_metadata(
                binding.read_authority(),
                &state,
                value.cache_metadata().ok_or(SearchError::Protocol)?,
            )?;
            Ok(value)
        })
    }

    pub fn query<B: SearchBinding>(
        &self,
        binding: &B,
        input: QueryIntent,
        cancel: &CancelToken,
    ) -> Result<SearchResponse, SearchError> {
        let deadline = Instant::now() + READ_BUDGET;
        let input = crate::contributor::normalize_intent(input)?;
        if input.suggestions && binding.read_authority() == ReadAuthority::RemoteOwner {
            return Err(SearchError::SourceUnavailable(binding.source_id().into()));
        }
        let (page, hydrated) = self.query_source(binding, input, cancel, deadline)?;
        let mut state = hydrated.state;
        state.no_store |= page.cache.as_ref().is_some_and(|c| c.no_store);
        let response = SearchResponse {
            items: hydrated.items,
            next_cursor: page.next_cursor.clone(),
            has_more: !page.next_cursor.is_empty(),
            coverage: page.coverage.clone().into_iter().collect(),
            expires_at_unix_ms: page.expires_at_unix_ms,
            sources: vec![state.clone()],
            partition: binding.partition().into(),
        };
        binding.publish(|| {
            cancel.check()?;
            self.sessions.remember(
                &response,
                &page,
                binding.source_revision(),
                binding.read_authority(),
            )?;
            Ok(response)
        })
    }

    pub(crate) fn query_source<B: SearchBinding>(
        &self,
        binding: &B,
        input: QueryIntent,
        cancel: &CancelToken,
        deadline: Instant,
    ) -> Result<(SourcePage, Hydrated), SearchError> {
        let refresh = input.refresh;
        let page = self.source_page(binding, input, cancel, deadline)?;
        let references = page
            .candidates
            .iter()
            .map(|candidate| candidate.resource.clone().ok_or(SearchError::Protocol))
            .collect::<Result<_, _>>()?;
        let mut hydrated = self.hydrate(binding, references, refresh, cancel, deadline)?;
        if binding.read_authority() == ReadAuthority::RemoteOwner {
            if hydrated.state.source_revision.is_empty() {
                apply_observation(
                    &mut hydrated.state,
                    page.cache.as_ref().ok_or(SearchError::Protocol)?,
                )?;
            }
            if let Some(coverage) = &page.coverage {
                hydrated.state.state = coverage.state;
                hydrated.state.extent = coverage.extent;
            }
        }
        Ok((page, hydrated))
    }

    pub(crate) fn source_page<B: SearchBinding>(
        &self,
        binding: &B,
        mut input: QueryIntent,
        cancel: &CancelToken,
        deadline: Instant,
    ) -> Result<SourcePage, SearchError> {
        let source = self.source(binding)?;
        if input.suggestions && !source.supports_suggestions() {
            return Err(SearchError::SourceUnavailable(binding.source_id().into()));
        }
        input = crate::contributor::narrow_intent(source.descriptor(), &input)
            .ok_or(SearchError::InvalidQuery)?;
        let refresh = input.refresh;
        input.refresh = false;
        input.text = input.text.trim().to_owned();
        let read_key = key(binding, "query", &input);
        let executor = self.executor.clone();
        let page: SourcePage =
            self.read(binding, read_key, refresh, cancel, deadline, move |ctx| {
                let page = executor.block_on(source.query(&input, &ctx))?;
                validate_page(source.descriptor(), &input, &page)?;
                Ok(page)
            })?;
        if page.expires_at_unix_ms <= now_ms()? as i64 {
            return Err(SearchError::CursorExpired);
        }
        Ok(page)
    }

    /// All misses enter one original-domain batch. Resources retain independent
    /// shared operations, allowing other queries to reuse unchanged projections.
    pub(crate) fn hydrate<B: SearchBinding>(
        &self,
        binding: &B,
        references: Vec<ResourceRef>,
        refresh: bool,
        cancel: &CancelToken,
        deadline: Instant,
    ) -> Result<Hydrated, SearchError> {
        let source = self.source(binding)?;
        let state = binding.read_state()?;
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
            read_key.read_scope = state.read_scope.clone();
            read_key
                .binding
                .push_str(&format!(":{:?}", state.policy_revision));
            if let Some(bytes) = (!state.no_store)
                .then(|| self.cache.validator_payload(&read_key))
                .flatten()
            {
                if let Ok(outcome) = HydrationOutcome::decode(bytes.as_ref()) {
                    if let Some(hydration_outcome::Outcome::Changed(projection)) = outcome.outcome {
                        if let Some(cache) = &projection.cache {
                            item.known_validator = cache.validator.clone();
                            validators.insert(item.item_id.clone(), projection);
                        }
                    }
                }
            }
            let (subscription, operation) = self.cache.subscribe(
                read_key,
                refresh || state.no_store,
                deadline.saturating_duration_since(Instant::now()),
            )?;
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
            let state = state.clone();
            self.executor.spawn(Box::new(move || {
                let ctx = SearchExecutionContext {
                    partition: binding.partition().into(),
                    read_scope: state.read_scope.clone(),
                    binding_revision: binding.source_revision().into(),
                    deadline: leaders
                        .iter()
                        .map(|(_, op)| op.deadline)
                        .max()
                        .unwrap_or(deadline),
                    cancel: CancelToken::all(
                        leaders.iter().map(|(_, op)| op.cancel.clone()).collect(),
                    ),
                };
                let request = HydrationRequest {
                    items: leaders.iter().map(|(item, _)| item.clone()).collect(),
                    refresh,
                };
                let read = ctx
                    .check()
                    .and_then(|()| executor.block_on(source.hydrate(&request, &ctx)))
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
                        // Substitute validators and encode outside the original
                        // authority guard. Each resource keeps its own operation.
                        let prepared: Vec<_> = leaders
                            .iter()
                            .map(|(item, _)| {
                                outcomes
                                    .get(&item.item_id)
                                    .cloned()
                                    .ok_or(SearchError::Protocol)
                                    .and_then(|mut outcome| {
                                        if let Some(hydration_outcome::Outcome::Unchanged(
                                            unchanged,
                                        )) = &outcome.outcome
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
                                            outcome.outcome = Some(
                                                hydration_outcome::Outcome::Changed(projection),
                                            );
                                        }
                                        let bytes = outcome.encode_to_vec();
                                        Ok((outcome, bytes))
                                    })
                            })
                            .collect();
                        let published = ctx.check().and_then(|()| {
                            binding.publish(|| {
                                ctx.check()?;
                                for ((_, operation), prepared) in leaders.iter().zip(prepared) {
                                    let commit = prepared.and_then(|(outcome, bytes)| {
                                        let (fresh_until, no_store) = match &outcome.outcome {
                                            Some(hydration_outcome::Outcome::Changed(
                                                projection,
                                            )) => {
                                                let cache = projection
                                                    .cache
                                                    .as_ref()
                                                    .ok_or(SearchError::Protocol)?;
                                                validate_metadata(
                                                    binding.read_authority(),
                                                    &state,
                                                    cache,
                                                )?;
                                                (
                                                    freshness(cache)?,
                                                    cache.no_store || state.no_store,
                                                )
                                            }
                                            _ => (Instant::now(), true),
                                        };
                                        operation.commit(bytes, fresh_until, no_store)
                                    });
                                    if let Err(error) = commit {
                                        operation.fail(error);
                                    }
                                }
                                Ok(())
                            })
                        });
                        if let Err(error) = published {
                            for (_, operation) in leaders {
                                operation.fail(error.clone());
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
        // Never wait or decode while holding the authentication/Store guard.
        let mut projections = Vec::new();
        for subscription in subscriptions {
            let bytes = subscription.wait(cancel, deadline)?;
            let outcome =
                HydrationOutcome::decode(bytes.as_ref()).map_err(|_| SearchError::Protocol)?;
            match outcome.outcome {
                Some(hydration_outcome::Outcome::Changed(projection)) => {
                    projections.push(projection);
                }
                Some(hydration_outcome::Outcome::Unavailable(_)) => {}
                _ => return Err(SearchError::Protocol),
            }
        }
        let ctx = SearchExecutionContext {
            partition: binding.partition().into(),
            read_scope: state.read_scope.clone(),
            binding_revision: binding.source_revision().into(),
            deadline,
            cancel: cancel.clone(),
        };
        ctx.check()?;
        binding.publish(|| {
            ctx.check()?;
            let mut items = Vec::new();
            let mut observed: Option<SourceReadState> = None;
            for projection in projections {
                let cache = projection.cache.as_ref().ok_or(SearchError::Protocol)?;
                validate_metadata(binding.read_authority(), &state, cache)?;
                if binding.read_authority() == ReadAuthority::RemoteOwner {
                    let mut current = state.clone();
                    apply_observation(&mut current, cache)?;
                    if observed
                        .as_ref()
                        .is_some_and(|previous| previous != &current)
                    {
                        return Err(SearchError::SourceChanged);
                    }
                    observed = Some(current);
                }
                let mut result = projection.result.ok_or(SearchError::Protocol)?;
                result.source_id = binding.source_id().into();
                result.read_validity = cache.read_validity.clone();
                items.push(result);
            }
            Ok(Hydrated {
                items,
                state: observed.unwrap_or(state),
            })
        })
    }

    pub fn resolve<B: SearchBinding>(
        &self,
        binding: &B,
        resource: ResourceRef,
        cancel: &CancelToken,
    ) -> Result<ResolvedResource, SearchError> {
        self.resolve_all(
            std::slice::from_ref(binding),
            binding.source_id(),
            resource,
            cancel,
        )
    }

    pub(crate) fn resolve_source<B: SearchBinding>(
        &self,
        binding: &B,
        resource: ResourceRef,
        cancel: &CancelToken,
    ) -> Result<ResolvedResource, SearchError> {
        let source = self.source(binding)?;
        let read_key = key(binding, "resolve", &resource);
        let executor = self.executor.clone();
        self.read(
            binding,
            read_key,
            false,
            cancel,
            Instant::now() + READ_BUDGET,
            move |ctx| {
                let resolved = executor.block_on(source.resolve(&resource, &ctx))?;
                if resolved.resource.as_ref().is_none_or(|r| r != &resource)
                    || resolved.resolver_binding.is_empty()
                {
                    return Err(SearchError::Protocol);
                }
                Ok(resolved)
            },
        )
    }
}

pub(crate) fn validate_metadata(
    authority: ReadAuthority,
    state: &SourceReadState,
    metadata: &CacheMetadata,
) -> Result<(), SearchError> {
    let validity = metadata
        .read_validity
        .as_ref()
        .ok_or(SearchError::Protocol)?;
    if authority == ReadAuthority::RemoteOwner {
        if !state.no_store
            || !metadata.no_store
            || !validity.owner_check_required
            || validity.lease_until_unix_ms != 0
            || metadata.source_revision.is_empty()
            || validity.policy_revision.is_empty()
        {
            return Err(SearchError::Protocol);
        }
        if validity.read_scope != state.read_scope {
            return Err(SearchError::SourceChanged);
        }
        return Ok(());
    }
    if metadata.source_revision != state.source_revision
        || validity.read_scope != state.read_scope
        || validity.policy_revision != state.policy_revision
        || (!validity.owner_check_required && validity.lease_until_unix_ms <= now_ms()? as i64)
    {
        return Err(SearchError::SourceChanged);
    }
    Ok(())
}

pub(crate) fn apply_observation(
    state: &mut SourceReadState,
    metadata: &CacheMetadata,
) -> Result<(), SearchError> {
    let validity = metadata
        .read_validity
        .as_ref()
        .ok_or(SearchError::Protocol)?;
    state.source_revision = metadata.source_revision.clone();
    state.read_scope = validity.read_scope.clone();
    state.policy_revision = validity.policy_revision.clone();
    state.no_store |= metadata.no_store;
    Ok(())
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
                    scopes: vec![SearchScope::Device as i32],
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
            message_id: "message".into(),
            conversation_id: "conversation".into(),
            content_revision: "one".into(),
            ..Default::default()
        };
        let cancel = CancelToken::new();
        runtime
            .sessions
            .remember(
                &SearchResponse {
                    items: vec![ResultItem {
                        resource: Some(resource.clone()),
                        source_id: binding.source_id().into(),
                        read_validity: Some(ReadValidity {
                            read_scope: "identity".into(),
                            policy_revision: "one".into(),
                            owner_check_required: true,
                            lease_until_unix_ms: 0,
                        }),
                        ..Default::default()
                    }],
                    sources: vec![binding.read_state().unwrap()],
                    partition: "identity".into(),
                    expires_at_unix_ms: now_ms().unwrap() as i64 + 60_000,
                    ..Default::default()
                },
                &SourcePage::default(),
                binding.source_revision(),
                binding.read_authority(),
            )
            .unwrap();
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
