use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use std::task::{Context, Poll, Wake, Waker};
use std::time::{Duration, Instant};

use search_core::model::wire::*;
use search_core::runtime::{now_ms, ReadAuthority, SearchBinding, SearchExecutor, SearchRuntime};
use search_core::{
    CancelToken, SearchContributor, SearchError, SearchExecutionContext, SourceFuture,
};

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
        match future
            .as_mut()
            .poll(&mut Context::from_waker(&Waker::from(Arc::new(ReadyWake))))
        {
            Poll::Ready(result) => result,
            Poll::Pending => panic!("synchronous test port"),
        }
    }
    fn observe_read(&self, _: bool, _: bool) {}
    fn observe_hydration(&self, _: usize, _: usize, _: bool) {}
}

struct Source {
    descriptor: SearchContributorDescriptor,
    query_reads: AtomicUsize,
    hydrates: AtomicUsize,
    resolves: AtomicUsize,
    delay: Duration,
    hydration_delay: Duration,
    repeat_first_at: Option<usize>,
    fail: bool,
    no_store: bool,
    lease_ms: i64,
    deny_reads: AtomicBool,
    remote: bool,
    observation: AtomicUsize,
    wrong_scope: AtomicBool,
    mixed_observation: bool,
    hydration_pause: Option<Arc<HydrationPause>>,
    suggestions: bool,
    revision: String,
    query_specific: bool,
}
impl Source {
    fn new(id: &str, scope: SearchScope) -> Self {
        Self {
            descriptor: SearchContributorDescriptor {
                source_id: id.into(),
                binding_id: format!("{id}.read"),
                owning_module: "test-owner".into(),
                descriptor_revision: "one".into(),
                authority_namespaces: vec!["authority".into()],
                kinds: vec![SearchKind::Knowledge as i32],
                scopes: vec![scope as i32],
                max_batch: 100,
                supports_paging: true,
            },
            query_reads: AtomicUsize::new(0),
            hydrates: AtomicUsize::new(0),
            resolves: AtomicUsize::new(0),
            delay: Duration::ZERO,
            hydration_delay: Duration::ZERO,
            repeat_first_at: None,
            fail: false,
            no_store: false,
            lease_ms: 0,
            deny_reads: AtomicBool::new(false),
            remote: false,
            observation: AtomicUsize::new(0),
            wrong_scope: AtomicBool::new(false),
            mixed_observation: false,
            hydration_pause: None,
            suggestions: true,
            revision: "one".into(),
            query_specific: false,
        }
    }
    fn resource(&self, index: usize) -> ResourceRef {
        ResourceRef {
            kind: "knowledge".into(),
            id: if index == 0 || self.repeat_first_at == Some(index) {
                "shared".into()
            } else {
                format!("{}-{index:03}", self.descriptor.source_id)
            },
            authority_namespace: "authority".into(),
            content_revision: "one".into(),
            ..Default::default()
        }
    }
    fn cache(&self) -> CacheMetadata {
        CacheMetadata {
            source_revision: if self.remote {
                format!(
                    "owner-observation:{}",
                    self.observation.load(Ordering::SeqCst)
                )
            } else {
                self.revision.clone()
            },
            validator: "one".into(),
            content_fresh_until_unix_ms: now_ms().unwrap() as i64 + 60_000,
            read_validity: Some(ReadValidity {
                read_scope: if self.wrong_scope.load(Ordering::SeqCst) {
                    "other".into()
                } else {
                    "actor".into()
                },
                policy_revision: if self.remote {
                    format!("owner-policy:{}", self.observation.load(Ordering::SeqCst))
                } else {
                    "one".into()
                },
                owner_check_required: self.lease_ms == 0,
                lease_until_unix_ms: if self.lease_ms == 0 {
                    0
                } else {
                    now_ms().unwrap() as i64 + self.lease_ms
                },
            }),
            no_store: self.no_store,
        }
    }
}
impl SearchContributor for Source {
    fn descriptor(&self) -> &SearchContributorDescriptor {
        &self.descriptor
    }
    fn supports_suggestions(&self) -> bool {
        self.suggestions
    }
    fn query<'a>(
        &'a self,
        input: &'a QueryIntent,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, SourcePage> {
        Box::pin(async move {
            self.query_reads.fetch_add(1, Ordering::SeqCst);
            self.observation.fetch_add(1, Ordering::SeqCst);
            let until = Instant::now() + self.delay;
            while Instant::now() < until {
                ctx.check()?;
                std::thread::sleep(Duration::from_millis(2));
            }
            ctx.check()?;
            if self.fail {
                return Err(SearchError::SourceUnavailable("test".into()));
            }
            assert_eq!(input.scopes, self.descriptor.scopes);
            assert_eq!(input.kinds, self.descriptor.kinds);
            let start = if input.cursor.is_empty() {
                0
            } else {
                input.cursor.parse::<usize>().unwrap()
            };
            let end = (start + input.limit as usize).min(120);
            Ok(SourcePage {
                candidates: (start..end)
                    .map(|i| {
                        let mut resource = self.resource(i);
                        if self.query_specific {
                            resource.id = format!("{}:{}", input.text, resource.id);
                        }
                        SourceCandidate {
                            resource: Some(resource),
                            source_rank: (i - start + 1) as f64,
                        }
                    })
                    .collect(),
                next_cursor: if end < 120 {
                    end.to_string()
                } else {
                    String::new()
                },
                coverage: Some(SourceCoverage {
                    source_id: self.descriptor.source_id.clone(),
                    state: SourceState::Ready as i32,
                    extent: CoverageExtent::DeclaredScope as i32,
                    detail_key: String::new(),
                }),
                cache: Some(self.cache()),
                expires_at_unix_ms: now_ms().unwrap() as i64 + 60_000,
            })
        })
    }
    fn hydrate<'a>(
        &'a self,
        input: &'a HydrationRequest,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, HydrationReply> {
        Box::pin(async move {
            let batch = self
                .hydration_pause
                .as_ref()
                .map(|pause| pause.hold(ctx))
                .transpose()?;
            let until = Instant::now() + self.hydration_delay;
            while Instant::now() < until {
                ctx.check()?;
                std::thread::sleep(Duration::from_millis(2));
            }
            ctx.check()?;
            self.hydrates.fetch_add(1, Ordering::SeqCst);
            self.observation.fetch_add(1, Ordering::SeqCst);
            if self.deny_reads.load(Ordering::SeqCst) {
                return Ok(HydrationReply {
                    outcomes: input
                        .items
                        .iter()
                        .map(|i| HydrationOutcome {
                            item_id: i.item_id.clone(),
                            outcome: Some(hydration_outcome::Outcome::Unavailable(
                                UnavailableResource {},
                            )),
                        })
                        .collect(),
                });
            }
            // The original owner observes one fixed snapshot per batch even
            // when other reads complete while this reply is being assembled.
            let mut cache = self.cache();
            if let Some(batch) = batch {
                cache.source_revision = format!("batch:{batch}");
                cache.read_validity.as_mut().unwrap().policy_revision = format!("policy:{batch}");
            }
            Ok(HydrationReply {
                outcomes: input
                    .items
                    .iter()
                    .enumerate()
                    .map(|(index, i)| {
                        let mut cache = cache.clone();
                        if self.mixed_observation && index == 0 {
                            cache.source_revision.push_str(":different");
                        }
                        HydrationOutcome {
                            item_id: i.item_id.clone(),
                            outcome: Some(hydration_outcome::Outcome::Changed(
                                AuthorizedProjection {
                                    result: Some(ResultItem {
                                        resource: i.resource.clone(),
                                        kind: SearchKind::Knowledge as i32,
                                        source_id: self.descriptor.source_id.clone(),
                                        title: "authorized".into(),
                                        ..Default::default()
                                    }),
                                    fields: i.fields.clone(),
                                    cache: Some(cache),
                                },
                            )),
                        }
                    })
                    .collect(),
            })
        })
    }
    fn resolve<'a>(
        &'a self,
        resource: &'a ResourceRef,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, ResolvedResource> {
        Box::pin(async move {
            ctx.check()?;
            self.resolves.fetch_add(1, Ordering::SeqCst);
            self.observation.fetch_add(1, Ordering::SeqCst);
            if self.deny_reads.load(Ordering::SeqCst) {
                return Err(SearchError::ResourceUnavailable);
            }
            Ok(ResolvedResource {
                resource: Some(resource.clone()),
                resolver_binding: "test.open".into(),
                cache: Some(self.cache()),
            })
        })
    }
}

#[derive(Clone)]
struct Binding {
    source: Arc<Source>,
    active: Arc<AtomicBool>,
    publication_guard: Arc<std::sync::Mutex<()>>,
    revision: String,
    partition: String,
}
impl Binding {
    fn new(source: Source) -> Self {
        Self {
            source: Arc::new(source),
            active: Arc::new(AtomicBool::new(true)),
            publication_guard: Default::default(),
            revision: "one".into(),
            partition: "actor".into(),
        }
    }
}
impl SearchBinding for Binding {
    fn partition(&self) -> &str {
        &self.partition
    }
    fn source_revision(&self) -> &str {
        &self.revision
    }
    fn source_id(&self) -> &str {
        &self.source.descriptor.source_id
    }
    fn binding_id(&self) -> &str {
        &self.source.descriptor.binding_id
    }
    fn check(&self) -> Result<(), SearchError> {
        if self.active.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(SearchError::Cancelled)
        }
    }
    fn publish<T>(
        &self,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let _guard = self.publication_guard.lock().unwrap();
        self.check()?;
        publish()
    }
    fn publish_sources<T>(
        &self,
        _: &[SourceReadState],
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        // Match the host's atomic publication contract, including consumption.
        self.publish(publish)
    }
    fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError> {
        Ok(self.source.clone())
    }
    fn read_authority(&self) -> ReadAuthority {
        if self.source.remote {
            ReadAuthority::RemoteOwner
        } else {
            ReadAuthority::LocalSnapshot
        }
    }
    fn read_state(&self) -> Result<SourceReadState, SearchError> {
        self.check()?;
        Ok(SourceReadState {
            source_id: self.source_id().into(),
            binding_id: self.binding_id().into(),
            source_revision: if self.source.remote {
                String::new()
            } else {
                self.revision.clone()
            },
            read_scope: "actor".into(),
            policy_revision: if self.source.remote {
                String::new()
            } else {
                "one".into()
            },
            state: SourceState::Ready as i32,
            extent: CoverageExtent::DeclaredScope as i32,
            no_store: self.source.no_store || self.source.remote,
        })
    }
}
fn intent() -> QueryIntent {
    QueryIntent {
        text: "query".into(),
        scopes: vec![SearchScope::Device as i32, SearchScope::Station as i32],
        ..Default::default()
    }
}

#[derive(Default)]
struct HydrationPause {
    admissions: std::sync::Mutex<Vec<(usize, usize)>>,
    changed: std::sync::Condvar,
    released: AtomicBool,
    batches: AtomicUsize,
}
impl HydrationPause {
    fn hold(&self, ctx: &SearchExecutionContext) -> Result<usize, SearchError> {
        let batch = self.batches.fetch_add(1, Ordering::SeqCst);
        let mut admissions = self.admissions.lock().unwrap();
        while !self.released.load(Ordering::SeqCst) {
            ctx.check()?;
            admissions = self
                .changed
                .wait_timeout(admissions, Duration::from_millis(10))
                .unwrap()
                .0;
        }
        Ok(batch)
    }

    fn wait_for(&self, count: usize) -> Vec<(usize, usize)> {
        let (admissions, timed) = self
            .changed
            .wait_timeout_while(
                self.admissions.lock().unwrap(),
                Duration::from_secs(2),
                |admissions| admissions.len() < count,
            )
            .unwrap();
        assert!(!timed.timed_out(), "hydration subscribers did not arrive");
        admissions.clone()
    }

    fn release(&self) {
        self.released.store(true, Ordering::SeqCst);
        self.changed.notify_all();
    }
}

#[derive(Clone)]
struct HydrationExecutor(Arc<HydrationPause>);
impl Default for HydrationExecutor {
    fn default() -> Self {
        // Only the whole-batch regression uses this executor. The runtime's
        // Default host factory and the test source share its bounded observer.
        static PAUSE: std::sync::OnceLock<Arc<HydrationPause>> = std::sync::OnceLock::new();
        Self(PAUSE.get_or_init(Default::default).clone())
    }
}
impl SearchExecutor for HydrationExecutor {
    fn spawn(&self, job: Box<dyn FnOnce() + Send>) {
        Executor.spawn(job);
    }
    fn block_on<T: Send>(&self, future: SourceFuture<'_, T>) -> Result<T, SearchError> {
        Executor.block_on(future)
    }
    fn observe_read(&self, _: bool, _: bool) {}
    fn observe_hydration(&self, reads: usize, resources: usize, _: bool) {
        self.0.admissions.lock().unwrap().push((reads, resources));
        self.0.changed.notify_all();
    }
}

#[test]
fn remote_whole_batch_sharing_preserves_overlap_cancellation_and_no_store() {
    for overlapping in [true, false] {
        let pause = HydrationExecutor::default().0;
        pause.admissions.lock().unwrap().clear();
        pause.released.store(false, Ordering::SeqCst);
        pause.batches.store(0, Ordering::SeqCst);
        let mut source = Source::new("remote", SearchScope::Station);
        source.remote = true;
        source.no_store = true;
        source.hydration_pause = Some(pause.clone());
        let binding = Binding::new(source);
        let runtime = SearchRuntime::<HydrationExecutor>::default();
        let cancel = CancelToken::new();
        let first = {
            let binding = binding.clone();
            let runtime = runtime.clone();
            let cancel = cancel.clone();
            std::thread::spawn(move || runtime.query(&binding, intent(), &cancel))
        };
        assert_eq!(pause.wait_for(1), [(20, 20)]);
        let second = {
            let binding = binding.clone();
            let runtime = runtime.clone();
            let mut input = intent();
            // A distinct candidate query deterministically reaches hydration.
            // Equal reference windows must share despite differing query text.
            if overlapping {
                input.cursor = "1".into();
            } else {
                input.text = "another query".into();
            }
            std::thread::spawn(move || runtime.query(&binding, input, &CancelToken::new()))
        };
        let expected_reads = if overlapping { 20 } else { 0 };
        let admissions = pause.wait_for(2);
        if !overlapping {
            cancel.cancel();
            assert_eq!(first.join().unwrap(), Err(SearchError::Cancelled));
            pause.release();
            let second = second.join().unwrap().unwrap();
            assert_eq!(second.items.len(), 20);
            assert_eq!(pause.batches.load(Ordering::SeqCst), 1);
            assert!(second.sources[0].no_store);
            let resource = second.items[0].resource.clone().unwrap();
            assert_eq!(
                runtime
                    .resolve(&binding, resource.clone(), &CancelToken::new())
                    .unwrap()
                    .resource,
                Some(resource.clone())
            );
            let fresh = runtime
                .query(&binding, intent(), &CancelToken::new())
                .unwrap();
            assert_eq!(pause.batches.load(Ordering::SeqCst), 2);
            assert_ne!(
                fresh.sources[0].source_revision,
                second.sources[0].source_revision
            );
            binding.source.deny_reads.store(true, Ordering::SeqCst);
            assert!(runtime
                .query(&binding, intent(), &CancelToken::new())
                .unwrap()
                .items
                .is_empty());
            assert_eq!(pause.batches.load(Ordering::SeqCst), 3);
            assert_eq!(
                runtime.resolve(&binding, resource, &CancelToken::new()),
                Err(SearchError::ResourceUnavailable)
            );
        } else {
            pause.release();
            let first = first.join().unwrap().unwrap();
            let second = second.join().unwrap().unwrap();
            assert_eq!(pause.batches.load(Ordering::SeqCst), 2);
            assert_ne!(
                first.sources[0].source_revision,
                second.sources[0].source_revision
            );
            assert_eq!(first.items.len(), 20);
            assert_eq!(second.items.len(), 20);
            for (index, item) in first.items.iter().enumerate() {
                assert_eq!(
                    item.resource.as_ref(),
                    Some(&binding.source.resource(index))
                );
            }
            for (index, item) in second.items.iter().enumerate() {
                assert_eq!(
                    item.resource.as_ref(),
                    Some(&binding.source.resource(index + 1))
                );
            }
        }
        assert_eq!(admissions, [(20, 20), (expected_reads, 20)]);
    }
}

#[derive(Clone)]
struct GuardedBinding {
    inner: Binding,
    guard: Arc<std::sync::Mutex<()>>,
    publications: Arc<AtomicUsize>,
    hydration_publications: Arc<AtomicUsize>,
    stop_at: usize,
    cancel_at_stop: Option<CancelToken>,
    composition_pause: Option<Arc<PublicationPause>>,
}
struct PublicationPause {
    calls: AtomicUsize,
    entered: std::sync::Barrier,
    resume: std::sync::Barrier,
}
impl GuardedBinding {
    fn new(source: Source) -> Self {
        Self {
            inner: Binding::new(source),
            guard: Default::default(),
            publications: Default::default(),
            hydration_publications: Default::default(),
            stop_at: 0,
            cancel_at_stop: None,
            composition_pause: None,
        }
    }
}
impl SearchBinding for GuardedBinding {
    fn partition(&self) -> &str {
        self.inner.partition()
    }
    fn source_revision(&self) -> &str {
        self.inner.source_revision()
    }
    fn source_id(&self) -> &str {
        self.inner.source_id()
    }
    fn binding_id(&self) -> &str {
        self.inner.binding_id()
    }
    fn check(&self) -> Result<(), SearchError> {
        self.inner.check()
    }
    fn publish<T>(
        &self,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let _guard = self.guard.lock().unwrap();
        self.publications.fetch_add(1, Ordering::SeqCst);
        if self.inner.source.hydrates.load(Ordering::SeqCst) > 0 {
            let count = self.hydration_publications.fetch_add(1, Ordering::SeqCst) + 1;
            if count == self.stop_at {
                if let Some(cancel) = &self.cancel_at_stop {
                    cancel.cancel();
                } else {
                    self.inner.active.store(false, Ordering::SeqCst);
                }
            }
        }
        self.check()?;
        publish()
    }
    fn publish_sources<T>(
        &self,
        _: &[SourceReadState],
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let call = self
            .composition_pause
            .as_ref()
            .map(|pause| pause.calls.fetch_add(1, Ordering::SeqCst) + 1);
        let result = self.publish(publish);
        if call == Some(3) {
            let pause = self.composition_pause.as_ref().unwrap();
            pause.entered.wait();
            pause.resume.wait();
        }
        result
    }
    fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError> {
        self.inner.contributor()
    }
    fn read_authority(&self) -> ReadAuthority {
        self.inner.read_authority()
    }
    fn read_state(&self) -> Result<SourceReadState, SearchError> {
        self.inner.read_state()
    }
}

#[test]
fn bounded_hydration_publication_cost_preserves_three_source_results() {
    let runtime = SearchRuntime::<Executor>::default();
    let guard = Arc::new(std::sync::Mutex::new(()));
    let bindings: Vec<_> = ["device", "private", "station"]
        .into_iter()
        .map(|id| {
            let mut source = Source::new(id, SearchScope::Device);
            source.no_store = true;
            let mut binding = GuardedBinding::new(source);
            binding.guard = guard.clone();
            binding
        })
        .collect();
    let page = runtime
        .query_all(&bindings, intent(), &CancelToken::new())
        .unwrap();
    assert_eq!(page.items.len(), 20);
    assert_eq!(page.items[0].score, 3.0 / 61.0);
    assert_eq!(page.items[0].source_id, "device");
    assert!(page
        .coverage
        .iter()
        .all(|c| c.state == SourceState::Ready as i32));
    assert!(page.sources.iter().all(|s| s.no_store));
    let publications: usize = bindings
        .iter()
        .map(|b| b.publications.load(Ordering::SeqCst))
        .sum();
    assert!(publications <= 32, "bounded authority cost: {publications}");
    assert!(bindings
        .iter()
        .all(|b| b.inner.source.hydrates.load(Ordering::SeqCst) == 1));
}

#[test]
fn hydration_batch_rejects_revocation_and_cancellation_at_commit_or_consumption() {
    for remote in [false, true] {
        for stop_at in [1, 2] {
            for cancel_at_stop in [false, true] {
                let runtime = SearchRuntime::<Executor>::default();
                let mut source = Source::new("device", SearchScope::Device);
                source.remote = remote;
                source.no_store = true;
                let mut binding = GuardedBinding::new(source);
                binding.stop_at = stop_at;
                let cancel = CancelToken::new();
                if cancel_at_stop {
                    binding.cancel_at_stop = Some(cancel.clone());
                }
                assert_eq!(
                    runtime.query(&binding, intent(), &cancel),
                    Err(SearchError::Cancelled)
                );
                assert_eq!(binding.inner.source.hydrates.load(Ordering::SeqCst), 1);
                assert_eq!(
                    binding.hydration_publications.load(Ordering::SeqCst),
                    stop_at
                );
            }
        }
    }
}

#[test]
fn hydration_batch_rejects_mixed_remote_owner_observations() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut source = Source::new("remote", SearchScope::Station);
    source.remote = true;
    source.no_store = true;
    source.mixed_observation = true;
    let binding = Binding::new(source);
    assert_eq!(
        runtime.query(&binding, intent(), &CancelToken::new()),
        Err(SearchError::SourceChanged)
    );
    assert_eq!(binding.source.hydrates.load(Ordering::SeqCst), 1);
    assert_eq!(
        runtime.resolve(&binding, binding.source.resource(0), &CancelToken::new()),
        Err(SearchError::ResourceUnavailable)
    );
    assert_eq!(binding.source.resolves.load(Ordering::SeqCst), 0);
}

#[test]
fn continuation_response_releases_issuance_guard_before_immediate_open() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut source = Source::new("remote", SearchScope::Station);
    source.remote = true;
    source.no_store = true;
    let mut binding = GuardedBinding::new(source);
    let pause = Arc::new(PublicationPause {
        calls: AtomicUsize::new(0),
        entered: std::sync::Barrier::new(2),
        resume: std::sync::Barrier::new(2),
    });
    binding.composition_pause = Some(pause.clone());
    let first = runtime
        .query_all(
            std::slice::from_ref(&binding),
            intent(),
            &CancelToken::new(),
        )
        .unwrap();
    let worker = {
        let runtime = runtime.clone();
        let binding = binding.clone();
        std::thread::spawn(move || {
            runtime.query_all(
                &[binding],
                QueryIntent {
                    cursor: first.next_cursor,
                    ..intent()
                },
                &CancelToken::new(),
            )
        })
    };
    pause.entered.wait();
    let next = worker.join().unwrap().unwrap();
    let resolved = runtime.resolve_all(
        std::slice::from_ref(&binding),
        "remote",
        next.items[0].resource.clone().unwrap(),
        &CancelToken::new(),
    );
    // Always release the paused publisher before checking the result.
    pause.resume.wait();
    assert_eq!(resolved.unwrap().resource, next.items[0].resource);
}

#[test]
fn fused_pages_preserve_unissued_candidates_and_resolve_only_issuing_source() {
    let runtime = SearchRuntime::<Executor>::default();
    let bindings = vec![
        Binding::new(Source::new("device", SearchScope::Device)),
        Binding::new(Source::new("station", SearchScope::Station)),
    ];
    let cancel = CancelToken::new();
    let first = runtime.query_all(&bindings, intent(), &cancel).unwrap();
    assert_eq!(first.items.len(), 20);
    assert_eq!(first.items[0].resource.as_ref().unwrap().id, "shared");
    assert_eq!(first.items[0].source_id, "device");
    assert_eq!(first.items[0].score, 2.0 / 61.0);
    assert_eq!(first.items[1].score, 1.0 / 62.0);
    assert!(first.has_more);
    let warm = runtime.query_all(&bindings, intent(), &cancel).unwrap();
    assert_eq!(warm, first);
    assert_eq!(bindings[0].source.query_reads.load(Ordering::SeqCst), 1);
    let mut seen = std::collections::HashSet::new();
    for item in &first.items {
        assert!(seen.insert(item.resource.as_ref().unwrap().fusion_key()));
    }
    let mut cursor = first.next_cursor.clone();
    while !cursor.is_empty() {
        let page = runtime
            .query_all(&bindings, QueryIntent { cursor, ..intent() }, &cancel)
            .unwrap();
        cursor = page.next_cursor;
        for item in &page.items {
            assert!(seen.insert(item.resource.as_ref().unwrap().fusion_key()));
        }
    }
    assert_eq!(seen.len(), 239);
    assert_eq!(bindings[0].source.query_reads.load(Ordering::SeqCst), 2);
    let item = first
        .items
        .iter()
        .find(|i| i.source_id == "device" && i.resource.as_ref().unwrap().id != "shared")
        .unwrap();
    let resource = item.resource.clone().unwrap();
    assert!(runtime
        .resolve_all(&bindings, "station", resource.clone(), &cancel)
        .is_err());
    assert_eq!(bindings[1].source.resolves.load(Ordering::SeqCst), 0);
    runtime
        .resolve_all(&bindings, "device", resource.clone(), &cancel)
        .unwrap();
    let mut forged = resource;
    forged.content_revision = "forged".into();
    assert!(runtime
        .resolve_all(&bindings, "device", forged, &cancel)
        .is_err());
}

#[test]
fn new_source_pages_cannot_reissue_a_prior_pages_object() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut source = Source::new("device", SearchScope::Device);
    source.repeat_first_at = Some(100);
    let bindings = vec![Binding::new(source)];
    let mut seen = std::collections::HashSet::new();
    let mut cursor = String::new();
    for page_index in 0..8 {
        let page = runtime
            .query_all(
                &bindings,
                QueryIntent { cursor, ..intent() },
                &CancelToken::new(),
            )
            .unwrap();
        for item in page.items {
            assert!(seen.insert(item.resource.unwrap().fusion_key()));
        }
        cursor = page.next_cursor;
        if cursor.is_empty() {
            break;
        }
        assert!(page_index < 7, "continuation must exhaust");
    }
    assert_eq!(seen.len(), 119);
    assert_eq!(bindings[0].source.query_reads.load(Ordering::SeqCst), 2);
}

#[test]
fn selectors_narrow_execution_and_failed_source_is_independent() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut failed = Source::new("station", SearchScope::Station);
    failed.fail = true;
    let bindings = vec![
        Binding::new(Source::new("device", SearchScope::Device)),
        Binding::new(failed),
    ];
    let page = runtime
        .query_all(&bindings, intent(), &CancelToken::new())
        .unwrap();
    assert_eq!(page.items.len(), 20);
    assert_eq!(
        page.coverage
            .iter()
            .find(|c| c.source_id == "station")
            .unwrap()
            .state,
        SourceState::Unavailable as i32
    );
    let page = runtime
        .query_all(
            &bindings,
            QueryIntent {
                suggestions: true,
                scopes: vec![SearchScope::Device as i32],
                ..intent()
            },
            &CancelToken::new(),
        )
        .unwrap();
    assert_eq!(page.sources.len(), 1);
    assert_eq!(bindings[1].source.query_reads.load(Ordering::SeqCst), 1);
}

#[test]
fn continuation_rejects_changed_sources_tampering_and_eviction() {
    let runtime = SearchRuntime::<Executor>::default();
    let binding = Binding::new(Source::new("device", SearchScope::Device));
    let bindings = vec![binding.clone()];
    let first = runtime
        .query_all(&bindings, intent(), &CancelToken::new())
        .unwrap();
    let mut changed = binding.clone();
    changed.revision = "two".into();
    assert_eq!(
        runtime.query_all(
            &[changed],
            QueryIntent {
                cursor: first.next_cursor.clone(),
                ..intent()
            },
            &CancelToken::new()
        ),
        Err(SearchError::SourceChanged)
    );
    assert!(runtime
        .query_all(
            &bindings,
            QueryIntent {
                cursor: format!("{}x", first.next_cursor),
                ..intent()
            },
            &CancelToken::new()
        )
        .is_err());
    runtime.invalidate_partitions(|p| p == "actor");
    assert_eq!(
        runtime.query_all(
            &bindings,
            QueryIntent {
                cursor: first.next_cursor,
                ..intent()
            },
            &CancelToken::new()
        ),
        Err(SearchError::CursorExpired)
    );
}

#[test]
fn no_store_projects_to_source_vector_and_never_reuses_content() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut source = Source::new("station", SearchScope::Station);
    source.no_store = true;
    source.lease_ms = 2000;
    let binding = Binding::new(source);
    let first = runtime
        .query_all(
            std::slice::from_ref(&binding),
            intent(),
            &CancelToken::new(),
        )
        .unwrap();
    assert!(first.sources[0].no_store);
    runtime
        .query_all(
            std::slice::from_ref(&binding),
            intent(),
            &CancelToken::new(),
        )
        .unwrap();
    assert_eq!(binding.source.query_reads.load(Ordering::SeqCst), 2);
    assert_eq!(binding.source.hydrates.load(Ordering::SeqCst), 2);
    let resource = first.items[0].resource.clone().unwrap();
    runtime
        .resolve_all(
            std::slice::from_ref(&binding),
            "station",
            resource.clone(),
            &CancelToken::new(),
        )
        .unwrap();
    runtime
        .resolve_all(
            std::slice::from_ref(&binding),
            "station",
            resource,
            &CancelToken::new(),
        )
        .unwrap();
    assert_eq!(binding.source.resolves.load(Ordering::SeqCst), 2);
}

#[test]
fn independent_subscriber_cancel_does_not_abort_shared_read() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut source = Source::new("device", SearchScope::Device);
    source.delay = Duration::from_millis(100);
    let binding = Binding::new(source);
    let first_cancel = CancelToken::new();
    let worker = {
        let runtime = runtime.clone();
        let binding = binding.clone();
        let cancel = first_cancel.clone();
        std::thread::spawn(move || runtime.query_all(&[binding], intent(), &cancel))
    };
    while binding.source.query_reads.load(Ordering::SeqCst) == 0 {
        std::thread::yield_now();
    }
    let second = {
        let runtime = runtime.clone();
        let binding = binding.clone();
        std::thread::spawn(move || runtime.query_all(&[binding], intent(), &CancelToken::new()))
    };
    std::thread::sleep(Duration::from_millis(20));
    first_cancel.cancel();
    assert_eq!(worker.join().unwrap(), Err(SearchError::Cancelled));
    assert!(second.join().unwrap().is_ok());
    assert_eq!(binding.source.query_reads.load(Ordering::SeqCst), 1);
}

#[test]
fn slow_source_timeout_preserves_fast_source_within_total_budget() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut slow = Source::new("station", SearchScope::Station);
    slow.delay = Duration::from_secs(10);
    let mut device = Source::new("device", SearchScope::Device);
    device.hydration_delay = Duration::from_millis(300);
    let bindings = vec![Binding::new(device), Binding::new(slow)];
    let start = Instant::now();
    let page = runtime
        .query_all(&bindings, intent(), &CancelToken::new())
        .unwrap();
    assert!(start.elapsed() < Duration::from_millis(5100));
    assert_eq!(page.items.len(), 20);
    assert!(page.items.iter().all(|item| item.source_id == "device"));
    assert_eq!(bindings[0].source.hydrates.load(Ordering::SeqCst), 1);
    assert_eq!(
        page.coverage
            .iter()
            .find(|c| c.source_id == "station")
            .unwrap()
            .detail_key,
        "search.coverage.source_timeout"
    );
}

#[test]
fn slow_hydration_does_not_block_another_sources_authorized_page() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut slow = Source::new("station", SearchScope::Station);
    slow.hydration_delay = Duration::from_secs(10);
    let mut device = Source::new("device", SearchScope::Device);
    device.hydration_delay = Duration::from_millis(300);
    let bindings = vec![Binding::new(device), Binding::new(slow)];
    let start = Instant::now();
    let page = runtime
        .query_all(&bindings, intent(), &CancelToken::new())
        .unwrap();
    assert!(start.elapsed() < Duration::from_millis(5100));
    assert_eq!(page.items.len(), 20);
    assert!(page.items.iter().all(|item| item.source_id == "device"));
    assert_eq!(
        page.coverage
            .iter()
            .find(|c| c.source_id == "station")
            .unwrap()
            .detail_key,
        "search.coverage.source_timeout"
    );
}

#[test]
fn malformed_or_outside_descriptor_resolution_is_protocol_before_issuance() {
    for direct in [false, true] {
        let runtime = SearchRuntime::<Executor>::default();
        let binding = Binding::new(Source::new("device", SearchScope::Device));
        let cancel = CancelToken::new();
        let resolve = |resource| {
            if direct {
                runtime.resolve(&binding, resource, &cancel)
            } else {
                runtime.resolve_all(std::slice::from_ref(&binding), "device", resource, &cancel)
            }
        };
        let reference = binding.source.resource(1);
        let mut forged = reference.clone();
        forged.authority_namespace = "station:forged".into();
        assert_eq!(resolve(forged), Err(SearchError::Protocol));
        let mut lookalike = reference.clone();
        lookalike.authority_namespace = "authority-lookalike".into();
        assert_eq!(resolve(lookalike), Err(SearchError::Protocol));
        let mut wrong_kind = reference.clone();
        wrong_kind.kind = "social-post".into();
        assert_eq!(resolve(wrong_kind), Err(SearchError::Protocol));
        let mut malformed = reference.clone();
        malformed.id.clear();
        assert_eq!(resolve(malformed), Err(SearchError::Protocol));
        assert_eq!(resolve(reference), Err(SearchError::ResourceUnavailable));
        assert_eq!(binding.source.resolves.load(Ordering::SeqCst), 0);
        let page = runtime
            .query_all(std::slice::from_ref(&binding), intent(), &cancel)
            .unwrap();
        let reference = page.items[0].resource.clone().unwrap();
        let mut forged = reference.clone();
        forged.authority_namespace = "station:forged".into();
        assert_eq!(resolve(forged), Err(SearchError::Protocol));
        resolve(reference).unwrap();
        assert_eq!(binding.source.resolves.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn direct_query_registers_refs_and_unknown_or_revoked_resolution_fails_closed() {
    let runtime = SearchRuntime::<Executor>::default();
    let binding = Binding::new(Source::new("device", SearchScope::Device));
    assert_eq!(
        runtime.resolve(&binding, binding.source.resource(1), &CancelToken::new()),
        Err(SearchError::ResourceUnavailable)
    );
    let page = runtime
        .query(&binding, intent(), &CancelToken::new())
        .unwrap();
    let reference = page.items[0].resource.clone().unwrap();
    runtime
        .resolve(&binding, reference.clone(), &CancelToken::new())
        .unwrap();
    binding.active.store(false, Ordering::SeqCst);
    assert!(runtime
        .query_all(
            std::slice::from_ref(&binding),
            intent(),
            &CancelToken::new()
        )
        .is_err());
    assert!(runtime
        .resolve(&binding, reference, &CancelToken::new())
        .is_err());
}

#[test]
fn simultaneous_refresh_and_continuation_cannot_advance_one_cursor_twice() {
    let runtime = SearchRuntime::<Executor>::default();
    let binding = Binding::new(Source::new("device", SearchScope::Device));
    let first = runtime
        .query_all(
            std::slice::from_ref(&binding),
            intent(),
            &CancelToken::new(),
        )
        .unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let workers: Vec<_> = [false, true]
        .into_iter()
        .map(|refresh| {
            let runtime = runtime.clone();
            let binding = binding.clone();
            let cursor = first.next_cursor.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                runtime.query_all(
                    &[binding],
                    QueryIntent {
                        cursor,
                        refresh,
                        ..intent()
                    },
                    &CancelToken::new(),
                )
            })
        })
        .collect();
    let results: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
    let successes: Vec<_> = results.iter().filter_map(|r| r.as_ref().ok()).collect();
    if successes.len() == 2 {
        assert_eq!(successes[0], successes[1]);
    } else {
        assert_eq!(successes.len(), 1);
        assert!(results.contains(&Err(SearchError::CursorExpired)));
    }
}

#[test]
fn cached_first_page_reacquires_issuance_after_session_capacity_eviction() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut source = Source::new("device", SearchScope::Device);
    source.query_specific = true;
    let binding = Binding::new(source);
    let bindings = std::slice::from_ref(&binding);
    let cancel = CancelToken::new();
    let first = runtime.query_all(bindings, intent(), &cancel).unwrap();
    runtime
        .query_all(
            bindings,
            QueryIntent {
                cursor: first.next_cursor.clone(),
                ..intent()
            },
            &cancel,
        )
        .unwrap();
    for i in 0..7 {
        runtime
            .query_all(
                bindings,
                QueryIntent {
                    text: format!("independent query {i}"),
                    ..intent()
                },
                &cancel,
            )
            .unwrap();
    }
    let old_resource = first.items[0].resource.clone().unwrap();
    assert_eq!(
        runtime.resolve_all(bindings, "device", old_resource, &cancel),
        Err(SearchError::ResourceUnavailable)
    );
    let reads = binding.source.query_reads.load(Ordering::SeqCst);
    let repeated = runtime.query_all(bindings, intent(), &cancel).unwrap();
    assert!(binding.source.query_reads.load(Ordering::SeqCst) > reads);
    assert_eq!(repeated.items, first.items);
    let resource = repeated.items[0].resource.clone().unwrap();
    assert_eq!(
        runtime
            .resolve_all(bindings, "device", resource.clone(), &cancel)
            .unwrap()
            .resource,
        Some(resource)
    );
    assert_eq!(
        runtime.query_all(
            bindings,
            QueryIntent {
                cursor: first.next_cursor,
                ..intent()
            },
            &cancel,
        ),
        Err(SearchError::CursorExpired)
    );
}

#[test]
fn session_capacity_eviction_expires_old_cursor_without_query_restart() {
    let runtime = SearchRuntime::<Executor>::default();
    let binding = Binding::new(Source::new("device", SearchScope::Device));
    let first = runtime
        .query_all(
            std::slice::from_ref(&binding),
            intent(),
            &CancelToken::new(),
        )
        .unwrap();
    for i in 0..10 {
        runtime
            .query_all(
                std::slice::from_ref(&binding),
                QueryIntent {
                    text: format!("query {i}"),
                    ..intent()
                },
                &CancelToken::new(),
            )
            .unwrap();
    }
    let reads = binding.source.query_reads.load(Ordering::SeqCst);
    assert_eq!(
        runtime.query_all(
            std::slice::from_ref(&binding),
            QueryIntent {
                cursor: first.next_cursor,
                ..intent()
            },
            &CancelToken::new()
        ),
        Err(SearchError::CursorExpired)
    );
    assert_eq!(binding.source.query_reads.load(Ordering::SeqCst), reads);
}

#[test]
fn expired_lease_cannot_resolve_or_reuse_prior_response() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut source = Source::new("station", SearchScope::Station);
    source.lease_ms = 100;
    let binding = Binding::new(source);
    let first = runtime
        .query_all(
            std::slice::from_ref(&binding),
            intent(),
            &CancelToken::new(),
        )
        .unwrap();
    std::thread::sleep(Duration::from_millis(120));
    assert_eq!(
        runtime.resolve_all(
            std::slice::from_ref(&binding),
            "station",
            first.items[0].resource.clone().unwrap(),
            &CancelToken::new()
        ),
        Err(SearchError::ResourceUnavailable)
    );
    runtime
        .query_all(
            std::slice::from_ref(&binding),
            intent(),
            &CancelToken::new(),
        )
        .unwrap();
    assert_eq!(binding.source.query_reads.load(Ordering::SeqCst), 2);
}

#[test]
fn no_store_pending_refs_recheck_original_policy_without_any_offline_lease() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut source = Source::new("authority-source", SearchScope::Device);
    source.no_store = true;
    let binding = Binding::new(source);
    let first = runtime
        .query_all(
            std::slice::from_ref(&binding),
            intent(),
            &CancelToken::new(),
        )
        .unwrap();
    assert_eq!(first.items.len(), 20);
    assert_eq!(
        first.items[0]
            .read_validity
            .as_ref()
            .unwrap()
            .lease_until_unix_ms,
        0
    );
    binding.source.deny_reads.store(true, Ordering::SeqCst);
    let continued = runtime
        .query_all(
            std::slice::from_ref(&binding),
            QueryIntent {
                cursor: first.next_cursor,
                ..intent()
            },
            &CancelToken::new(),
        )
        .unwrap();
    assert!(continued.items.is_empty());
    assert_eq!(binding.source.query_reads.load(Ordering::SeqCst), 1);
    assert_eq!(binding.source.hydrates.load(Ordering::SeqCst), 2);
    assert_eq!(
        runtime.resolve_all(
            std::slice::from_ref(&binding),
            "authority-source",
            first.items[0].resource.clone().unwrap(),
            &CancelToken::new()
        ),
        Err(SearchError::ResourceUnavailable)
    );
}

#[test]
fn remote_observations_are_not_transport_revisions_and_recheck_each_operation() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut source = Source::new("remote", SearchScope::Station);
    source.remote = true;
    source.no_store = true;
    let binding = Binding::new(source);
    let bindings = std::slice::from_ref(&binding);
    let unknown = runtime.read_states(bindings).unwrap();
    assert!(unknown.sources[0].source_revision.is_empty());
    assert!(unknown.sources[0].policy_revision.is_empty());
    let first = runtime
        .query_all(bindings, intent(), &CancelToken::new())
        .unwrap();
    assert_eq!(first.sources[0].source_revision, "owner-observation:2");
    assert_eq!(first.sources[0].policy_revision, "owner-policy:2");
    assert!(first
        .items
        .iter()
        .all(|i| i.read_validity.as_ref().unwrap().policy_revision == "owner-policy:2"));
    let next = runtime
        .query_all(
            bindings,
            QueryIntent {
                cursor: first.next_cursor,
                ..intent()
            },
            &CancelToken::new(),
        )
        .unwrap();
    assert_eq!(next.sources[0].source_revision, "owner-observation:3");
    assert_eq!(binding.source.query_reads.load(Ordering::SeqCst), 1);
    let resolved = runtime
        .resolve_all(
            bindings,
            "remote",
            first.items[0].resource.clone().unwrap(),
            &CancelToken::new(),
        )
        .unwrap();
    assert_eq!(
        resolved.cache.unwrap().source_revision,
        "owner-observation:4"
    );
    let mut changed = binding.clone();
    changed.revision = "new-transport".into();
    assert_eq!(
        runtime.resolve_all(
            &[changed],
            "remote",
            first.items[0].resource.clone().unwrap(),
            &CancelToken::new()
        ),
        Err(SearchError::ResourceUnavailable)
    );
}

#[test]
fn remote_scope_retention_and_lease_claims_are_rejected_without_cross_source_loss() {
    for invalid in 0..3 {
        let runtime = SearchRuntime::<Executor>::default();
        let mut source = Source::new("remote", SearchScope::Station);
        source.remote = true;
        source.no_store = invalid != 0;
        if invalid == 1 {
            source.lease_ms = 1000;
        }
        if invalid == 2 {
            source.wrong_scope.store(true, Ordering::SeqCst);
        }
        let bindings = vec![
            Binding::new(Source::new("device", SearchScope::Device)),
            Binding::new(source),
        ];
        let result = runtime.query_all(&bindings, intent(), &CancelToken::new());
        if invalid == 2 {
            assert_eq!(result, Err(SearchError::SourceChanged));
        } else {
            let page = result.unwrap();
            assert_eq!(page.items.len(), 20);
            assert!(page.items.iter().all(|i| i.source_id == "device"));
            assert_eq!(bindings[1].source.hydrates.load(Ordering::SeqCst), 0);
        }
    }
}

#[test]
fn current_issuance_survives_older_sessions_of_the_same_resource() {
    for sample in 0..12 {
        let runtime = SearchRuntime::<Executor>::default();
        let mut old_source = Source::new("device", SearchScope::Device);
        old_source.no_store = true;
        let old = Binding::new(old_source);
        for query in 0..8 {
            runtime
                .query_all(
                    std::slice::from_ref(&old),
                    QueryIntent {
                        text: format!("old {sample} {query}"),
                        ..intent()
                    },
                    &CancelToken::new(),
                )
                .unwrap();
        }
        let mut source = Source::new("device", SearchScope::Device);
        source.no_store = true;
        source.revision = "two".into();
        let mut current = Binding::new(source);
        current.revision = "two".into();
        let bindings = std::slice::from_ref(&current);
        let unissued = current.source.resource(0);
        assert_eq!(
            runtime.resolve_all(bindings, "device", unissued, &CancelToken::new()),
            Err(SearchError::ResourceUnavailable)
        );
        assert_eq!(current.source.resolves.load(Ordering::SeqCst), 0);
        let presented = runtime
            .query_all(
                bindings,
                QueryIntent {
                    text: format!("current {sample}"),
                    ..intent()
                },
                &CancelToken::new(),
            )
            .unwrap();
        assert_eq!(presented.sources[0].source_revision, "two");
        assert!(!presented.items.is_empty());
        let resource = presented.items[0].resource.clone().unwrap();
        let resolved = runtime
            .resolve_all(bindings, "device", resource.clone(), &CancelToken::new())
            .unwrap();
        assert_eq!(resolved.resource, Some(resource.clone()));
        assert_eq!(current.source.resolves.load(Ordering::SeqCst), 1);
        current.source.deny_reads.store(true, Ordering::SeqCst);
        assert_eq!(
            runtime.resolve_all(bindings, "device", resource, &CancelToken::new()),
            Err(SearchError::ResourceUnavailable)
        );
        assert_eq!(current.source.resolves.load(Ordering::SeqCst), 2);
    }
}

#[test]
fn ineligible_suggestions_do_not_poison_source_vector_or_cache() {
    for remote in [false, true] {
        let runtime = SearchRuntime::<Executor>::default();
        let mut private = Source::new("private", SearchScope::Device);
        private.remote = remote;
        private.no_store = true;
        private.suggestions = false;
        let bindings = vec![
            Binding::new(Source::new("device", SearchScope::Device)),
            Binding::new(private),
        ];
        let input = QueryIntent {
            suggestions: true,
            scopes: vec![SearchScope::Device as i32],
            ..intent()
        };
        let first = runtime
            .query_all(&bindings, input.clone(), &CancelToken::new())
            .unwrap();
        let warm = runtime
            .query_all(&bindings, input, &CancelToken::new())
            .unwrap();
        assert_eq!(first, warm);
        assert_eq!(first.sources.len(), 1);
        assert!(!first.sources[0].no_store);
        assert_eq!(bindings[0].source.query_reads.load(Ordering::SeqCst), 1);
        assert_eq!(bindings[1].source.query_reads.load(Ordering::SeqCst), 0);
        assert_eq!(bindings[1].source.hydrates.load(Ordering::SeqCst), 0);
    }
}

struct AdmissionContributor(Arc<Source>);
impl SearchContributor for AdmissionContributor {
    fn descriptor(&self) -> &SearchContributorDescriptor {
        self.0.descriptor()
    }
    fn supports_suggestions(&self) -> bool {
        self.0.supports_suggestions()
    }
    fn query<'a>(
        &'a self,
        input: &'a QueryIntent,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, SourcePage> {
        Box::pin(async move {
            let mut page = self.0.query(input, ctx).await?;
            if self.descriptor().kinds == [SearchKind::Message as i32] {
                for candidate in &mut page.candidates {
                    let resource = candidate.resource.as_mut().unwrap();
                    resource.kind = "message".into();
                    resource.message_id = resource.id.clone();
                    resource.conversation_id = if input.conversation_id.is_empty() {
                        "conversation".into()
                    } else {
                        input.conversation_id.clone()
                    };
                }
            }
            Ok(page)
        })
    }
    fn hydrate<'a>(
        &'a self,
        input: &'a HydrationRequest,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, HydrationReply> {
        Box::pin(async move {
            let mut reply = self.0.hydrate(input, ctx).await?;
            for outcome in &mut reply.outcomes {
                if let Some(hydration_outcome::Outcome::Changed(projection)) = &mut outcome.outcome
                {
                    projection.result.as_mut().unwrap().kind = self.descriptor().kinds[0];
                }
            }
            Ok(reply)
        })
    }
    fn resolve<'a>(
        &'a self,
        resource: &'a ResourceRef,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, ResolvedResource> {
        self.0.resolve(resource, ctx)
    }
}

#[derive(Clone)]
struct AdmissionBinding {
    inner: Binding,
    owner_revision: Arc<AtomicUsize>,
    state_reads: Arc<AtomicUsize>,
    state_error: Option<SearchError>,
    construction_error: Option<SearchError>,
    malformed_state: bool,
}
impl AdmissionBinding {
    fn new(id: &str, kind: SearchKind) -> Self {
        let mut source = Source::new(id, SearchScope::Device);
        source.descriptor.kinds = vec![kind as i32];
        Self {
            inner: Binding::new(source),
            owner_revision: Arc::new(AtomicUsize::new(1)),
            state_reads: Default::default(),
            state_error: None,
            construction_error: None,
            malformed_state: false,
        }
    }
}
impl SearchBinding for AdmissionBinding {
    fn partition(&self) -> &str {
        self.inner.partition()
    }
    fn source_revision(&self) -> &str {
        self.inner.source_revision()
    }
    fn source_id(&self) -> &str {
        self.inner.source_id()
    }
    fn binding_id(&self) -> &str {
        self.inner.binding_id()
    }
    fn read_authority(&self) -> ReadAuthority {
        self.inner.read_authority()
    }
    fn check(&self) -> Result<(), SearchError> {
        self.inner.check()?;
        if self.owner_revision.load(Ordering::SeqCst) != 1 {
            return Err(SearchError::SourceChanged);
        }
        Ok(())
    }
    fn publish<T>(
        &self,
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        self.check()?;
        publish()
    }
    fn publish_sources<T>(
        &self,
        sources: &[SourceReadState],
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        self.inner.check()?;
        if sources.iter().any(|s| s.source_id == self.source_id()) {
            self.check()?;
        }
        publish()
    }
    fn read_state(&self) -> Result<SourceReadState, SearchError> {
        self.state_reads.fetch_add(1, Ordering::SeqCst);
        if let Some(error) = &self.state_error {
            return Err(error.clone());
        }
        self.check()?;
        let mut state = self.inner.read_state()?;
        if self.malformed_state {
            state.binding_id = "wrong-binding".into();
        }
        Ok(state)
    }
    fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError> {
        if let Some(error) = &self.construction_error {
            return Err(error.clone());
        }
        Ok(Arc::new(AdmissionContributor(self.inner.source.clone())))
    }
}

#[test]
fn query_admission_excluded_owner_cannot_veto_message_query_or_local_suggestion() {
    for suggestions in [false, true] {
        for excluded_first in [false, true] {
            for error in [
                None,
                Some(SearchError::SourceChanged),
                Some(SearchError::SourceUnavailable("original owner".into())),
            ] {
                let runtime = SearchRuntime::<Executor>::default();
                let message = AdmissionBinding::new("device.messaging", SearchKind::Message);
                let mut private = AdmissionBinding::new("device.social", SearchKind::Knowledge);
                private.state_error = error;
                // Native admission has captured revision one. The excluded
                // original owner changes before coordinator read-state entry.
                private.owner_revision.store(2, Ordering::SeqCst);
                let bindings = if excluded_first {
                    vec![private.clone(), message.clone()]
                } else {
                    vec![message.clone(), private.clone()]
                };
                let page = runtime
                    .query_all(
                        &bindings,
                        QueryIntent {
                            kinds: vec![SearchKind::Message as i32],
                            scopes: vec![SearchScope::Device as i32],
                            suggestions,
                            ..intent()
                        },
                        &CancelToken::new(),
                    )
                    .expect("excluded original owner must not veto healthy Messaging");
                assert_eq!(page.items.len(), 20);
                assert_eq!(page.sources.len(), 1);
                assert_eq!(page.sources[0].source_id, "device.messaging");
                assert_eq!(page.coverage.len(), 1);
                assert!(page.items.iter().all(|item| {
                    item.source_id == "device.messaging" && item.kind == SearchKind::Message as i32
                }));
                assert_eq!(message.inner.source.query_reads.load(Ordering::SeqCst), 1);
                assert_eq!(message.inner.source.hydrates.load(Ordering::SeqCst), 1);
                assert_eq!(private.state_reads.load(Ordering::SeqCst), 0);
                assert_eq!(private.inner.source.query_reads.load(Ordering::SeqCst), 0);
                assert_eq!(private.inner.source.hydrates.load(Ordering::SeqCst), 0);
                let resource = page.items[0].resource.clone().unwrap();
                assert_eq!(
                    runtime
                        .resolve_all(
                            &bindings,
                            "device.messaging",
                            resource.clone(),
                            &CancelToken::new()
                        )
                        .unwrap()
                        .resource,
                    Some(resource)
                );
                assert!(runtime.read_states(&bindings).is_err());
            }
        }
    }
}

#[test]
fn query_admission_narrows_descriptor_modes_before_original_state_reads() {
    for mode in 0..5 {
        let runtime = SearchRuntime::<Executor>::default();
        let message = AdmissionBinding::new("device.messaging", SearchKind::Message);
        let mut source = Source::new("excluded", SearchScope::Device);
        if mode == 2 {
            source.descriptor.scopes = vec![SearchScope::Station as i32];
        }
        if mode >= 3 {
            source.descriptor.kinds = vec![SearchKind::Message as i32];
            source.suggestions = false;
            source.remote = mode == 4;
        }
        let mut excluded = AdmissionBinding::new("excluded", SearchKind::Knowledge);
        excluded.inner = Binding::new(source);
        excluded.state_error = Some(SearchError::SourceChanged);
        let page = runtime
            .query_all(
                &[message.clone(), excluded.clone()],
                QueryIntent {
                    scopes: vec![SearchScope::Device as i32],
                    attachment_names_only: mode == 0,
                    conversation_id: if mode == 1 {
                        "conversation".into()
                    } else {
                        String::new()
                    },
                    suggestions: mode >= 3,
                    ..intent()
                },
                &CancelToken::new(),
            )
            .unwrap();
        assert_eq!(page.items.len(), 20);
        assert_eq!(page.sources.len(), 1);
        assert_eq!(excluded.state_reads.load(Ordering::SeqCst), 0);
        assert_eq!(excluded.inner.source.query_reads.load(Ordering::SeqCst), 0);
        assert_eq!(excluded.inner.source.hydrates.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn query_admission_included_owner_and_global_identity_still_reject() {
    for identity_changed in [false, true] {
        let runtime = SearchRuntime::<Executor>::default();
        let message = AdmissionBinding::new("device.messaging", SearchKind::Message);
        if identity_changed {
            message.inner.active.store(false, Ordering::SeqCst);
        } else {
            message.owner_revision.store(2, Ordering::SeqCst);
        }
        assert_eq!(
            runtime.query_all(&[message.clone()], intent(), &CancelToken::new()),
            Err(if identity_changed {
                SearchError::Cancelled
            } else {
                SearchError::SourceChanged
            })
        );
        assert_eq!(message.inner.source.query_reads.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn query_admission_preserves_composition_and_participating_state_protocol_checks() {
    for invalid in 0..5 {
        let runtime = SearchRuntime::<Executor>::default();
        let message = AdmissionBinding::new("device.messaging", SearchKind::Message);
        let mut excluded = AdmissionBinding::new("device.social", SearchKind::Knowledge);
        let bindings = match invalid {
            0 => vec![],
            1 => vec![message.clone(); 4],
            2 => vec![message.clone(), message.clone()],
            3 => {
                excluded.inner.partition = "another actor".into();
                vec![message.clone(), excluded]
            }
            _ => {
                let mut malformed = message.clone();
                malformed.malformed_state = true;
                vec![malformed]
            }
        };
        assert_eq!(
            runtime.query_all(
                &bindings,
                QueryIntent {
                    kinds: vec![SearchKind::Message as i32],
                    ..intent()
                },
                &CancelToken::new()
            ),
            Err(SearchError::Protocol)
        );
        assert_eq!(message.inner.source.query_reads.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn query_admission_unknown_contributor_failure_is_coverage_not_silent_omission() {
    let runtime = SearchRuntime::<Executor>::default();
    let message = AdmissionBinding::new("device.messaging", SearchKind::Message);
    let mut failed = AdmissionBinding::new("device.social", SearchKind::Knowledge);
    failed.construction_error = Some(SearchError::SourceUnavailable("constructor".into()));
    let bindings = [message.clone(), failed.clone()];
    let page = runtime
        .query_all(&bindings, intent(), &CancelToken::new())
        .unwrap();
    assert_eq!(page.items.len(), 20);
    assert_eq!(page.sources.len(), 2);
    let coverage = page
        .coverage
        .iter()
        .find(|c| c.source_id == "device.social")
        .unwrap();
    assert_eq!(coverage.state, SourceState::Unavailable as i32);
    assert_eq!(coverage.detail_key, "search.coverage.source_unavailable");
    assert_eq!(failed.state_reads.load(Ordering::SeqCst), 1);
    assert_eq!(failed.inner.source.query_reads.load(Ordering::SeqCst), 0);
    assert_eq!(runtime.read_states(&bindings).unwrap().sources.len(), 2);
}
