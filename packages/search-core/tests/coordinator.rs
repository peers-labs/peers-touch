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
    fail: bool,
    no_store: bool,
    lease_ms: i64,
    deny_reads: AtomicBool,
    remote: bool,
    observation: AtomicUsize,
    wrong_scope: AtomicBool,
    suggestions: bool,
    revision: String,
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
            fail: false,
            no_store: false,
            lease_ms: 0,
            deny_reads: AtomicBool::new(false),
            remote: false,
            observation: AtomicUsize::new(0),
            wrong_scope: AtomicBool::new(false),
            suggestions: true,
            revision: "one".into(),
        }
    }
    fn resource(&self, index: usize) -> ResourceRef {
        ResourceRef {
            kind: "knowledge".into(),
            id: if index == 0 {
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
                    .map(|i| SourceCandidate {
                        resource: Some(self.resource(i)),
                        source_rank: (i - start + 1) as f64,
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
            Ok(HydrationReply {
                outcomes: input
                    .items
                    .iter()
                    .map(|i| HydrationOutcome {
                        item_id: i.item_id.clone(),
                        outcome: Some(hydration_outcome::Outcome::Changed(AuthorizedProjection {
                            result: Some(ResultItem {
                                resource: i.resource.clone(),
                                kind: SearchKind::Knowledge as i32,
                                source_id: self.descriptor.source_id.clone(),
                                title: "authorized".into(),
                                ..Default::default()
                            }),
                            fields: i.fields.clone(),
                            cache: Some(self.cache()),
                        })),
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
    revision: String,
    partition: String,
}
impl Binding {
    fn new(source: Source) -> Self {
        Self {
            source: Arc::new(source),
            active: Arc::new(AtomicBool::new(true)),
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
        self.check()?;
        publish()
    }
    fn publish_sources<T>(
        &self,
        _: &[SourceReadState],
        publish: impl FnOnce() -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        // Tests exercise coordinator checks; production uses an atomic host guard.
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
    let bindings = vec![
        Binding::new(Source::new("device", SearchScope::Device)),
        Binding::new(slow),
    ];
    let start = Instant::now();
    let page = runtime
        .query_all(&bindings, intent(), &CancelToken::new())
        .unwrap();
    assert!(start.elapsed() < Duration::from_millis(5100));
    assert_eq!(page.items.len(), 20);
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
