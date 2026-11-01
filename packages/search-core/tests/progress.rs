//! Progressive source frames ride the same pipeline as the fused final frame.
//! The observer is a fenced side channel: one per-source read, no cursor, no
//! cache, and cancellation/identity transitions suppress stale delivery.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};
use std::time::{Duration, Instant};

use search_core::model::wire::*;
use search_core::runtime::{now_ms, ReadAuthority, SearchBinding, SearchExecutor, SearchRuntime};
use search_core::{
    CancelToken, ProgressFrame, ProgressObserver, SearchContributor, SearchError,
    SearchExecutionContext, SourceFuture,
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
    delay: Duration,
    fail: bool,
    total: usize,
    query_reads: AtomicUsize,
    hydrates: AtomicUsize,
}
impl Source {
    fn new(id: &str, scope: SearchScope) -> Self {
        Self {
            descriptor: SearchContributorDescriptor {
                source_id: id.into(),
                owning_module: "test-owner".into(),
                authority_namespaces: vec!["authority".into()],
                kinds: vec![SearchKind::Knowledge as i32],
                binding_id: format!("{id}.read"),
                descriptor_revision: "one".into(),
                supports_paging: true,
                max_batch: 100,
                scopes: vec![scope as i32],
            },
            delay: Duration::ZERO,
            fail: false,
            total: 20,
            query_reads: AtomicUsize::new(0),
            hydrates: AtomicUsize::new(0),
        }
    }
    fn resource(&self, index: usize) -> ResourceRef {
        ResourceRef {
            kind: "knowledge".into(),
            id: format!("{}-{index:03}", self.descriptor.source_id),
            authority_namespace: "authority".into(),
            content_revision: "one".into(),
            ..Default::default()
        }
    }
    fn cache(&self) -> CacheMetadata {
        CacheMetadata {
            source_revision: "one".into(),
            validator: "one".into(),
            content_fresh_until_unix_ms: now_ms().unwrap() as i64 + 60_000,
            read_validity: Some(ReadValidity {
                read_scope: "actor".into(),
                policy_revision: "one".into(),
                owner_check_required: true,
                lease_until_unix_ms: 0,
            }),
            no_store: false,
        }
    }
}
impl SearchContributor for Source {
    fn descriptor(&self) -> &SearchContributorDescriptor {
        &self.descriptor
    }
    fn query<'a>(
        &'a self,
        input: &'a QueryIntent,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, SourcePage> {
        Box::pin(async move {
            self.query_reads.fetch_add(1, Ordering::SeqCst);
            let until = Instant::now() + self.delay;
            while Instant::now() < until {
                ctx.check()?;
                std::thread::sleep(Duration::from_millis(2));
            }
            ctx.check()?;
            if self.fail {
                return Err(SearchError::SourceUnavailable("test".into()));
            }
            let start = if input.cursor.is_empty() {
                0
            } else {
                input.cursor.parse().unwrap()
            };
            let end = (start + input.limit as usize).min(self.total);
            Ok(SourcePage {
                candidates: (start..end)
                    .map(|index| SourceCandidate {
                        resource: Some(self.resource(index)),
                        source_rank: (index - start + 1) as f64,
                    })
                    .collect(),
                next_cursor: if end < self.total {
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
            Ok(HydrationReply {
                outcomes: input
                    .items
                    .iter()
                    .map(|item| HydrationOutcome {
                        item_id: item.item_id.clone(),
                        outcome: Some(hydration_outcome::Outcome::Changed(AuthorizedProjection {
                            result: Some(ResultItem {
                                resource: item.resource.clone(),
                                kind: SearchKind::Knowledge as i32,
                                source_id: self.descriptor.source_id.clone(),
                                title: format!("title-{}", self.descriptor.source_id),
                                snippet: format!("snippet-{}", self.descriptor.source_id),
                                ..Default::default()
                            }),
                            fields: item.fields.clone(),
                            cache: Some(self.cache()),
                        })),
                    })
                    .collect(),
            })
        })
    }
    fn resolve<'a>(
        &'a self,
        _: &'a ResourceRef,
        _: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, ResolvedResource> {
        Box::pin(async { Err(SearchError::ResourceUnavailable) })
    }
}

#[derive(Clone)]
struct Binding {
    source: Arc<Source>,
    active: Arc<AtomicBool>,
}
impl Binding {
    fn new(source: Source) -> Self {
        Self {
            source: Arc::new(source),
            active: Arc::new(AtomicBool::new(true)),
        }
    }
}
impl SearchBinding for Binding {
    fn partition(&self) -> &str {
        "actor"
    }
    fn source_revision(&self) -> &str {
        "one"
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
        // The trusted host validates the whole vector atomically; the test
        // composition's identity fence is this binding's active flag.
        self.publish(publish)
    }
    fn contributor(&self) -> Result<Arc<dyn SearchContributor>, SearchError> {
        Ok(self.source.clone())
    }
    fn read_authority(&self) -> ReadAuthority {
        ReadAuthority::LocalSnapshot
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
struct Recorder {
    frames: Mutex<Vec<ProgressFrame>>,
}
impl Recorder {
    fn shared() -> Arc<Self> {
        Arc::new(Self::default())
    }
    fn snapshot(&self) -> Vec<ProgressFrame> {
        self.frames.lock().unwrap().clone()
    }
}
impl ProgressObserver for Recorder {
    fn observe(&self, frame: ProgressFrame) {
        self.frames.lock().unwrap().push(frame);
    }
}

fn two_sources() -> Vec<Binding> {
    vec![
        Binding::new(Source::new("device", SearchScope::Device)),
        Binding::new(Source::new("station", SearchScope::Station)),
    ]
}

#[test]
fn progressive_frames_carry_per_source_items_before_final_rrf_frame() {
    let runtime = SearchRuntime::<Executor>::default();
    let bindings = two_sources();
    let recorder = Recorder::shared();
    let final_response = runtime
        .query_all_with_progress(&bindings, intent(), &CancelToken::new(), recorder.clone())
        .unwrap();

    // One frame per source, on the same pipeline, with only that source's items.
    let frames = recorder.snapshot();
    assert_eq!(frames.len(), 2);
    let mut observed_sources = frames
        .iter()
        .map(|frame| frame.source_id.clone())
        .collect::<Vec<_>>();
    observed_sources.sort();
    assert_eq!(observed_sources, ["device", "station"]);
    for frame in &frames {
        assert!(frame.response.next_cursor.is_empty());
        assert!(!frame.response.has_more);
        assert_eq!(frame.response.partition, "actor");
        assert_eq!(frame.response.sources.len(), 2);
        assert_eq!(frame.response.coverage.len(), 2);
        assert!(!frame.response.items.is_empty());
        assert!(frame
            .response
            .items
            .iter()
            .all(|item| item.source_id == frame.source_id));
        assert!(frame
            .response
            .items
            .iter()
            .all(|item| item.read_validity.is_some()));
    }

    // The final frame is fused across both sources and issued normally.
    // RRF ranks both sources first, so the 20-item first page is followed by
    // continuation pages carrying the rest.
    assert_eq!(final_response.items.len(), 20);
    assert!(final_response.has_more);
    assert!(final_response
        .sources
        .iter()
        .all(|state| state.state == SourceState::Ready as i32));
    let mut fused_sources = final_response
        .items
        .iter()
        .map(|item| item.source_id.clone())
        .collect::<std::collections::HashSet<_>>();
    let mut cursor = final_response.next_cursor.clone();
    let mut pages = 0;
    while !cursor.is_empty() {
        let page = runtime
            .query_all(
                &bindings,
                QueryIntent { cursor, ..intent() },
                &CancelToken::new(),
            )
            .unwrap();
        page.items.iter().for_each(|item| {
            fused_sources.insert(item.source_id.clone());
        });
        cursor = page.next_cursor;
        pages += 1;
        assert!(pages < 10, "fusion traversal must terminate");
    }
    assert_eq!(fused_sources.len(), 2);
}

#[test]
fn progress_rides_one_pipeline_without_a_second_query_or_hydration() {
    let runtime = SearchRuntime::<Executor>::default();
    let bindings = two_sources();
    runtime
        .query_all_with_progress(&bindings, intent(), &CancelToken::new(), Recorder::shared())
        .unwrap();
    for binding in &bindings {
        assert_eq!(binding.source.query_reads.load(Ordering::SeqCst), 1);
        assert_eq!(binding.source.hydrates.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn continuation_pages_emit_no_progressive_frames() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut source = Source::new("device", SearchScope::Device);
    source.total = 25;
    let bindings = vec![Binding::new(source)];
    let first = runtime
        .query_all_with_progress(&bindings, intent(), &CancelToken::new(), Recorder::shared())
        .unwrap();
    assert!(first.has_more);
    assert!(!first.next_cursor.is_empty());

    let continuation_recorder = Recorder::shared();
    let next = runtime
        .query_all_with_progress(
            &bindings,
            QueryIntent {
                cursor: first.next_cursor,
                ..intent()
            },
            &CancelToken::new(),
            continuation_recorder.clone(),
        )
        .unwrap();
    assert!(continuation_recorder.snapshot().is_empty());
    assert_eq!(next.items.len(), 5);
}

#[test]
fn failed_source_publishes_partial_frame_without_losing_the_fast_source() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut failed = Source::new("station", SearchScope::Station);
    failed.fail = true;
    let bindings = vec![
        Binding::new(Source::new("device", SearchScope::Device)),
        Binding::new(failed),
    ];
    let recorder = Recorder::shared();
    let final_response = runtime
        .query_all_with_progress(&bindings, intent(), &CancelToken::new(), recorder.clone())
        .unwrap();

    let frames = recorder.snapshot();
    let failed_frame = frames
        .iter()
        .find(|frame| frame.source_id == "station")
        .expect("failed source still reports a partial frame");
    assert!(failed_frame.response.items.is_empty());
    assert_eq!(
        failed_frame
            .response
            .coverage
            .iter()
            .find(|coverage| coverage.source_id == "station")
            .unwrap()
            .state,
        SourceState::Unavailable as i32
    );
    assert!(final_response
        .items
        .iter()
        .all(|item| item.source_id == "device"));
    assert_eq!(
        final_response
            .coverage
            .iter()
            .find(|coverage| coverage.source_id == "station")
            .unwrap()
            .state,
        SourceState::Unavailable as i32
    );
}

#[test]
fn cancellation_suppresses_later_frames_and_fails_the_final_frame() {
    let runtime = SearchRuntime::<Executor>::default();
    let mut slow = Source::new("station", SearchScope::Station);
    slow.delay = Duration::from_millis(300);
    let bindings = vec![
        Binding::new(Source::new("device", SearchScope::Device)),
        Binding::new(slow),
    ];
    let cancel = CancelToken::new();
    struct Cancelling {
        cancel: CancelToken,
        seen: Mutex<Vec<String>>,
    }
    impl ProgressObserver for Cancelling {
        fn observe(&self, frame: ProgressFrame) {
            self.seen.lock().unwrap().push(frame.source_id);
            self.cancel.cancel();
        }
    }
    let observer = Arc::new(Cancelling {
        cancel: cancel.clone(),
        seen: Mutex::new(Vec::new()),
    });
    let result = runtime.query_all_with_progress(&bindings, intent(), &cancel, observer.clone());
    assert_eq!(result, Err(SearchError::Cancelled));
    // The fast source delivered exactly one fenced frame; the slow source's
    // frame was suppressed after cancellation.
    let seen = observer.seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0], "device");
}

#[test]
fn identity_revocation_inside_the_observer_fences_final_publication() {
    let runtime = SearchRuntime::<Executor>::default();
    let bindings = two_sources();
    struct Revoking {
        active: Arc<AtomicBool>,
    }
    impl ProgressObserver for Revoking {
        fn observe(&self, _frame: ProgressFrame) {
            self.active.store(false, Ordering::SeqCst);
        }
    }
    let observer = Arc::new(Revoking {
        active: bindings[0].active.clone(),
    });
    let result =
        runtime.query_all_with_progress(&bindings, intent(), &CancelToken::new(), observer);
    assert!(matches!(
        result,
        Err(SearchError::Cancelled) | Err(SearchError::SourceChanged)
    ));
}
