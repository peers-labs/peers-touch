//! Compile and probe the exact authorized adapter without building crypto/hosts.

#[path = "../../messaging-core/src/search.rs"]
mod messaging;

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::task::{Context, Poll, Wake, Waker};
use std::time::{Duration, Instant};

use search_core::cursor::authenticated::AuthenticatedCursorCodec;
use search_core::model::wire::*;
use search_core::model::{ScoredDocument, TrustZone};
use search_core::{CancelToken, SearchContributor, SearchExecutionContext, SourceFuture};

#[derive(Default)]
struct Reader {
    conversations: AtomicUsize,
    messages: AtomicUsize,
    attachments: AtomicUsize,
}
fn document(id: &str, conversation: &str, kind: SearchKind) -> ScoredDocument {
    ScoredDocument {
        resource: ResourceRef {
            id: id.into(),
            kind: if kind == SearchKind::Message {
                "message"
            } else {
                "conversation"
            }
            .into(),
            authority_namespace: "authority".into(),
            conversation_id: conversation.into(),
            message_id: if kind == SearchKind::Message {
                id.into()
            } else {
                String::new()
            },
            ..Default::default()
        },
        kind,
        zone: TrustZone::DeviceE2ee,
        title: id.into(),
        snippet: "matching".into(),
        conversation_title: conversation.into(),
        author_ptid: "ptid".into(),
        created_at_unix_ms: 1,
        score: 1.0,
    }
}
impl messaging::MessagingSearchReader for Reader {
    fn search_revision(&self) -> Result<String, String> {
        Ok("one".into())
    }
    fn search_authorities(&self) -> Result<Vec<String>, String> {
        Ok(vec!["authority".into()])
    }
    fn search_index_ready(&self) -> Result<bool, String> {
        Ok(true)
    }
    fn search_device_documents(
        &self,
        conversation: Option<&str>,
        _: &str,
        attachments: bool,
        before: Option<(i64, &str, &str)>,
        limit: usize,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        check()?;
        self.messages.fetch_add(1, Ordering::SeqCst);
        if attachments {
            self.attachments.fetch_add(1, Ordering::SeqCst);
        }
        let start = if before.is_some() { 3 } else { 1 };
        Ok((start..=3)
            .take(limit)
            .map(|i| {
                document(
                    &format!("m{i}"),
                    conversation.unwrap_or("c1"),
                    SearchKind::Message,
                )
            })
            .collect())
    }
    fn suggest_conversations(
        &self,
        conversation: Option<&str>,
        _: &str,
        limit: usize,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        check()?;
        self.conversations.fetch_add(1, Ordering::SeqCst);
        Ok(vec![document(
            "c1",
            conversation.unwrap_or("c1"),
            SearchKind::Conversation,
        )]
        .into_iter()
        .take(limit)
        .collect())
    }
    fn search_read_resources(
        &self,
        refs: &[ResourceRef],
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Vec<ScoredDocument>, String> {
        check()?;
        Ok(refs
            .iter()
            .map(|r| {
                document(
                    &r.id,
                    &r.conversation_id,
                    if r.kind == "message" {
                        SearchKind::Message
                    } else {
                        SearchKind::Conversation
                    },
                )
            })
            .collect())
    }
}
struct ReadyWake;
impl Wake for ReadyWake {
    fn wake(self: Arc<Self>) {}
}
fn ready<T>(mut future: SourceFuture<'_, T>) -> Result<T, search_core::SearchError> {
    match future
        .as_mut()
        .poll(&mut Context::from_waker(&Waker::from(Arc::new(ReadyWake))))
    {
        Poll::Ready(result) => result,
        Poll::Pending => panic!("synchronous read port"),
    }
}
fn context() -> SearchExecutionContext {
    SearchExecutionContext {
        partition: "actor".into(),
        read_scope: "actor".into(),
        binding_revision: messaging::BINDING.into(),
        deadline: Instant::now() + Duration::from_secs(5),
        cancel: CancelToken::new(),
    }
}
fn intent() -> QueryIntent {
    QueryIntent {
        text: "matching".into(),
        kinds: vec![SearchKind::Message as i32],
        scopes: vec![SearchScope::Device as i32],
        limit: 2,
        ..Default::default()
    }
}
fn contributor(reader: Arc<Reader>) -> messaging::MessagingContributor {
    messaging::MessagingContributor::new(
        reader,
        "one".into(),
        Arc::new(AuthenticatedCursorCodec::new([7; 32])),
    )
    .unwrap()
}

#[test]
fn blank_suggestions_are_messaging_owned_and_mixed_selectors_work() {
    let reader = Arc::new(Reader::default());
    let source = contributor(reader.clone());
    assert_eq!(source.descriptor().scopes, [SearchScope::Device as i32]);
    let input = QueryIntent {
        text: String::new(),
        kinds: vec![SearchKind::Message as i32, SearchKind::Conversation as i32],
        suggestions: true,
        ..intent()
    };
    let page = ready(source.query(&input, &context())).unwrap();
    assert_eq!(
        page.candidates[0].resource.as_ref().unwrap().kind,
        "conversation"
    );
    assert_eq!(reader.messages.load(Ordering::SeqCst), 0);
    let mixed = QueryIntent {
        text: "matching".into(),
        suggestions: false,
        ..input
    };
    let page = ready(source.query(&mixed, &context())).unwrap();
    assert_eq!(page.candidates.len(), 2);
    assert_eq!(reader.messages.load(Ordering::SeqCst), 1);
}

#[test]
fn signed_message_continuation_hydration_and_attachment_filter_conform() {
    let reader = Arc::new(Reader::default());
    let source = contributor(reader.clone());
    let input = QueryIntent {
        conversation_id: "c1".into(),
        attachment_names_only: true,
        ..intent()
    };
    let page = ready(source.query(&input, &context())).unwrap();
    assert!(!page.next_cursor.is_empty());
    assert_eq!(reader.conversations.load(Ordering::SeqCst), 0);
    assert_eq!(reader.attachments.load(Ordering::SeqCst), 1);
    let request = HydrationRequest {
        items: vec![HydrationItem {
            item_id: "one".into(),
            resource: page.candidates[0].resource.clone(),
            fields: vec![ProjectionField::Result as i32],
            ..Default::default()
        }],
        refresh: false,
    };
    assert!(ready(source.hydrate(&request, &context())).is_ok());
    assert!(
        ready(source.resolve(page.candidates[0].resource.as_ref().unwrap(), &context())).is_ok()
    );
    let continued = ready(source.query(
        &QueryIntent {
            cursor: page.next_cursor.clone(),
            ..input.clone()
        },
        &context(),
    ))
    .unwrap();
    assert_eq!(continued.candidates[0].resource.as_ref().unwrap().id, "m3");
    let changed = QueryIntent {
        conversation_id: "other".into(),
        cursor: page.next_cursor,
        ..input
    };
    assert!(ready(source.query(&changed, &context())).is_err());
    assert!(ready(source.query(
        &QueryIntent {
            scopes: vec![SearchScope::Station as i32],
            ..intent()
        },
        &context()
    ))
    .is_err());
}
