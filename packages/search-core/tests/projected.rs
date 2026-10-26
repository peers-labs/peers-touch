use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use std::task::{Context, Poll, Wake, Waker};
use std::time::{Duration, Instant};

use search_core::cursor::authenticated::AuthenticatedCursorCodec;
use search_core::model::wire::*;
use search_core::model::{ScoredDocument, TrustZone};
use search_core::projected::{ProjectedContributor, ProjectedPage, ProjectedSearchReader};
use search_core::{
    CancelToken, SearchContributor, SearchError, SearchExecutionContext, SourceFuture,
};

#[derive(Default)]
struct Reader {
    reads: AtomicUsize,
    allowed: AtomicBool,
}
fn document() -> ScoredDocument {
    ScoredDocument {
        resource: ResourceRef {
            kind: "knowledge".into(),
            id: "object".into(),
            authority_namespace: "authority:root:original-domain".into(),
            ..Default::default()
        },
        kind: SearchKind::Knowledge,
        zone: TrustZone::DeviceE2ee,
        title: "authorized".into(),
        snippet: String::new(),
        conversation_title: String::new(),
        author_ptid: String::new(),
        created_at_unix_ms: 10,
        score: 1.0,
    }
}
impl ProjectedSearchReader for Reader {
    fn revision(&self) -> Result<String, SearchError> {
        Ok("native-index".into())
    }
    fn read_state(&self) -> Result<SourceReadState, SearchError> {
        Ok(SourceReadState {
            source_id: "source".into(),
            binding_id: "binding".into(),
            source_revision: format!("owner-observation:{}", self.reads.load(Ordering::SeqCst)),
            policy_revision: format!("owner-policy:{}", self.reads.load(Ordering::SeqCst)),
            read_scope: "actor".into(),
            state: SourceState::Ready as i32,
            extent: CoverageExtent::AcquiredLocal as i32,
            no_store: true,
        })
    }
    fn query_documents(
        &self,
        _: &QueryIntent,
        ctx: &SearchExecutionContext,
        before: Option<(i64, &str, &str)>,
        limit: usize,
    ) -> Result<ProjectedPage, SearchError> {
        ctx.check()?;
        assert!(limit <= 99);
        self.reads.fetch_add(1, Ordering::SeqCst);
        if let Some(before) = before {
            assert_eq!(before, (42, "knowledge", "denied-scan-position"));
            Ok(ProjectedPage {
                documents: vec![document()],
                next_before: None,
            })
        } else {
            Ok(ProjectedPage {
                documents: Vec::new(),
                next_before: Some((42, "knowledge".into(), "denied-scan-position".into())),
            })
        }
    }
    fn read_resources(
        &self,
        _: &[ResourceRef],
        ctx: &SearchExecutionContext,
    ) -> Result<Vec<ScoredDocument>, SearchError> {
        ctx.check()?;
        self.reads.fetch_add(1, Ordering::SeqCst);
        Ok(if self.allowed.load(Ordering::SeqCst) {
            vec![document()]
        } else {
            Vec::new()
        })
    }
}
struct ReadyWake;
impl Wake for ReadyWake {
    fn wake(self: Arc<Self>) {}
}
fn ready<T>(mut future: SourceFuture<'_, T>) -> Result<T, SearchError> {
    match future
        .as_mut()
        .poll(&mut Context::from_waker(&Waker::from(Arc::new(ReadyWake))))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("synchronous reader"),
    }
}
fn context() -> SearchExecutionContext {
    SearchExecutionContext {
        partition: "partition".into(),
        read_scope: "actor".into(),
        binding_revision: "transport".into(),
        deadline: Instant::now() + Duration::from_secs(5),
        cancel: CancelToken::new(),
    }
}
fn input() -> QueryIntent {
    QueryIntent {
        text: "query".into(),
        scopes: vec![SearchScope::Device as i32],
        kinds: vec![SearchKind::Knowledge as i32],
        limit: 100,
        ..Default::default()
    }
}
fn source(reader: Arc<Reader>) -> ProjectedContributor {
    ProjectedContributor::new(
        reader,
        SearchContributorDescriptor {
            source_id: "source".into(),
            binding_id: "binding".into(),
            owning_module: "owner".into(),
            descriptor_revision: "one".into(),
            authority_namespaces: vec!["authority:root".into()],
            kinds: vec![SearchKind::Knowledge as i32],
            scopes: vec![SearchScope::Device as i32],
            supports_paging: true,
            max_batch: 100,
        },
        "native-index".into(),
        "owner.open".into(),
        Arc::new(AuthenticatedCursorCodec::new([23; 32])),
    )
    .unwrap()
}

#[test]
fn empty_authorization_filtered_page_preserves_original_scan_position_and_expiry() {
    let source = source(Arc::new(Reader::default()));
    let first = ready(source.query(&input(), &context())).unwrap();
    assert!(first.candidates.is_empty());
    assert!(!first.next_cursor.is_empty());
    let next = ready(source.query(
        &QueryIntent {
            cursor: first.next_cursor,
            ..input()
        },
        &context(),
    ))
    .unwrap();
    assert_eq!(next.candidates.len(), 1);
    assert_eq!(next.expires_at_unix_ms, first.expires_at_unix_ms);
    let cache = next.cache.unwrap();
    assert!(cache.no_store);
    assert_eq!(cache.source_revision, "owner-observation:2");
    assert_eq!(cache.read_validity.unwrap().lease_until_unix_ms, 0);
}

#[test]
fn no_store_hydration_and_resolve_use_current_reader_observation() {
    let reader = Arc::new(Reader::default());
    reader.allowed.store(true, Ordering::SeqCst);
    let source = source(reader.clone());
    let first = ready(source.query(&input(), &context())).unwrap();
    let page = ready(source.query(
        &QueryIntent {
            cursor: first.next_cursor,
            ..input()
        },
        &context(),
    ))
    .unwrap();
    let reference = page.candidates[0].resource.clone().unwrap();
    let request = HydrationRequest {
        items: vec![HydrationItem {
            item_id: "item".into(),
            resource: Some(reference.clone()),
            fields: vec![ProjectionField::Result as i32],
            known_validator: reference.content_revision.clone(),
        }],
        refresh: false,
    };
    let reply = ready(source.hydrate(&request, &context())).unwrap();
    let Some(hydration_outcome::Outcome::Changed(changed)) = reply.outcomes[0].outcome.as_ref()
    else {
        panic!("no-store must not reuse a body")
    };
    assert_eq!(
        changed.cache.as_ref().unwrap().source_revision,
        "owner-observation:3"
    );
    reader.allowed.store(false, Ordering::SeqCst);
    assert_eq!(
        ready(source.resolve(&reference, &context())),
        Err(SearchError::ResourceUnavailable)
    );
}
