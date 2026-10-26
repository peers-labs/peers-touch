use super::*;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::SigningKey;
use prost::Message;
use reqwest::header::HeaderMap;

use crate::application::station_runtime::client::{
    ReplayPolicy, StationClient, StationRequest, StationRequestBody, StationRequestExecutor,
    StationRequestScope, StationResponse, StationTransportError, StationTransportErrorKind,
};
use crate::model::social::MomentReadPolicyOutcome;
use crate::secure_content::station_trust::TrustedStationSigningKey;
use crate::secure_content::store::SecureContentStore;
use crate::secure_content::{SecureContentSession, SecureContentSessionKey};
use crate::social::search_projection;

#[derive(Default)]
struct PolicyExecutor {
    requests: Mutex<Vec<CheckMomentReadPolicyRequest>>,
    denied: Mutex<HashSet<String>>,
    malformed: AtomicBool,
    wait_for_cancel: AtomicBool,
    cancelled: AtomicBool,
    invalidate: Mutex<Option<Arc<SecureContentStore>>>,
}

impl StationRequestExecutor for PolicyExecutor {
    fn execute(&self, request: StationRequest) -> Result<StationResponse, StationTransportError> {
        assert_eq!(request.path_and_query, "/api/v1/social/moments/read-policy");
        assert_eq!(request.method, reqwest::Method::POST);
        assert!(matches!(request.replay_policy, ReplayPolicy::Never));
        assert!(request.timeout <= Duration::from_secs(5));
        assert!(request.admission_timeout <= request.timeout);
        assert_eq!(request.expected_scope, self.active_scope());
        assert!(request.headers["authorization"]
            .to_str()
            .unwrap()
            .starts_with("Bearer "));
        assert_eq!(request.headers["x-device-id"], "device-1");
        let StationRequestBody::Bytes(bytes) = request.body else {
            panic!("expected protobuf")
        };
        let policy = CheckMomentReadPolicyRequest::decode(bytes.as_slice()).unwrap();
        assert!(policy.targets.len() <= SEARCH_BATCH_MAX);
        self.requests.lock().unwrap().push(policy.clone());
        if self.wait_for_cancel.load(Ordering::Acquire) {
            let until = Instant::now() + Duration::from_secs(2);
            while !request.cancellation.is_cancelled() && Instant::now() < until {
                std::thread::sleep(Duration::from_millis(2));
            }
            self.cancelled
                .store(request.cancellation.is_cancelled(), Ordering::Release);
            return Err(StationTransportError::new(
                StationTransportErrorKind::Cancelled,
                "read cancelled",
                false,
            ));
        }
        if let Some(store) = self.invalidate.lock().unwrap().take() {
            store.invalidate_search_policy().unwrap();
        }
        let denied = self.denied.lock().unwrap();
        let mut outcomes = policy
            .targets
            .iter()
            .rev()
            .map(|target| MomentReadPolicyOutcome {
                item_id: target.item_id.clone(),
                decision: if denied.contains(&target.item_id) {
                    MomentReadDecision::Unavailable as i32
                } else {
                    MomentReadDecision::Readable as i32
                },
            })
            .collect::<Vec<_>>();
        if self.malformed.load(Ordering::Acquire) && outcomes.len() > 1 {
            outcomes[0] = outcomes[1].clone();
        }
        Ok(StationResponse {
            status: 200,
            headers: HeaderMap::new(),
            body: Box::new(Cursor::new(
                CheckMomentReadPolicyResponse { outcomes }.encode_to_vec(),
            )),
        })
    }

    fn active_scope(&self) -> Option<StationRequestScope> {
        Some(StationRequestScope {
            station_peer_id: "station-1".to_string(),
            lifecycle_generation: 1,
        })
    }
    fn active_station_peer_id(&self) -> Option<String> {
        Some("station-1".to_string())
    }
    fn active_endpoint_origin(&self) -> Option<String> {
        Some("https://station.test".to_string())
    }
}

fn binding(executor: Arc<PolicyExecutor>) -> SecureContentSearchBinding {
    let key = SecureContentSessionKey {
        station_peer_id: "station-1".to_string(),
        station_lifecycle_generation: 1,
        actor_ptid: "ptid:reader".to_string(),
        device_id: "device-1".to_string(),
        jwt_session_id: "session-1".to_string(),
        window_label: "main".to_string(),
        session_generation: 1,
    };
    let expiry = super::super::search_now_ms() / 1000 + 60;
    let token = format!(
        "header.{}.signature",
        URL_SAFE_NO_PAD.encode(format!(r#"{{"exp":{expiry}}}"#))
    );
    let session = Arc::new(SecureContentSession::new(
        key.clone(),
        "account-1".to_string(),
        StationClient::new(executor),
        token,
        "signing-key-1".to_string(),
        1,
        SigningKey::from_bytes(&[7; 32]),
        TrustedStationSigningKey {
            key_id: "station-key-1".to_string(),
            verifying_key: SigningKey::from_bytes(&[8; 32]).verifying_key(),
        },
    ));
    SecureContentSearchBinding {
        key,
        store: Arc::new(SecureContentStore::in_memory().unwrap()),
        expires_at_unix_ms: session.search_expires_at_unix_ms,
        session,
    }
}

fn retained(reader: &SecureContentSearchBinding, comment_count: usize) {
    let post = serde_json::to_vec(&serde_json::json!({
        "post_id": "post-1", "content_id": "content-post-1", "generation": "1",
        "author_ptid": "ptid:author", "audience_kind": "DIRECT", "state": "CONTENT_READY",
        "content": { "kind": "TEXT", "text": "needle" }, "created_at_millis": 42,
    }))
    .unwrap();
    reader
        .store
        .commit_content_root("content-post-1", 1, "post-1", &[7; 32], None, &post)
        .unwrap();
    for number in 0..comment_count {
        let id = format!("comment-{number:03}");
        let content = format!("content-{id}");
        let bytes = serde_json::to_vec(&serde_json::json!({
            "comment_id": id, "post_id": "post-1", "content_id": content,
            "generation": "1", "author_ptid": "ptid:author", "state": "COMMENT_POSTED",
            "reply_to_comment_id": "", "reactions_count": 0, "replies_count": 0,
            "text": "needle", "created_at_millis": number + 42,
        }))
        .unwrap();
        reader
            .store
            .commit_comment_root(&content, 1, "post-1", &id, &[8; 32], None, &bytes)
            .unwrap();
    }
}

fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(5)
}

#[test]
fn private_social_policy_one_batch_query_and_hydrate_no_offline_lease_or_metadata_store() {
    let executor = Arc::new(PolicyExecutor::default());
    let reader = binding(executor.clone());
    retained(&reader, 4);
    let docs = reader
        .search_documents("needle", &[], None, 100, deadline(), &|| Ok(()))
        .unwrap();
    assert_eq!(docs.len(), 5);
    assert_eq!(executor.requests.lock().unwrap().len(), 1);
    let refs = docs.into_iter().map(|doc| doc.resource).collect::<Vec<_>>();
    executor
        .denied
        .lock()
        .unwrap()
        .insert("social-comment:comment-001".to_string());
    let hydrated = reader
        .search_read_resources(&refs, deadline(), &|| Ok(()))
        .unwrap();
    assert_eq!(hydrated.len(), 4);
    assert!(!hydrated.iter().any(|doc| doc.resource.id == "comment-001"));
    assert_eq!(executor.requests.lock().unwrap().len(), 2);
    let cache = reader.cache_metadata().unwrap();
    assert!(cache.no_store);
    let read = cache.read_validity.unwrap();
    assert!(read.owner_check_required);
    assert_eq!(read.lease_until_unix_ms, 0);
    reader.session.cancel_and_zeroize();
    assert!(reader
        .search_read_resources(&refs, deadline(), &|| Ok(()))
        .is_err());
    assert_eq!(executor.requests.lock().unwrap().len(), 2);
}

#[test]
fn private_social_policy_strict_correlation_rejects_missing_duplicate_unknown_and_unspecified() {
    let refs = vec![
        search_projection::resource_ref(POST, "post-1", "post-1", "r1"),
        search_projection::resource_ref(COMMENT, "comment-1", "post-1", "r2"),
    ];
    let request = policy_request(&refs).unwrap();
    for (first, second) in [
        ("social-post:post-1", "social-post:post-1"),
        ("social-post:post-1", "social-comment:unknown"),
    ] {
        let outcomes = [first, second]
            .into_iter()
            .map(|id| MomentReadPolicyOutcome {
                item_id: id.to_string(),
                decision: MomentReadDecision::Readable as i32,
            })
            .collect();
        assert!(authorized_resources(
            refs.clone(),
            &request,
            CheckMomentReadPolicyResponse { outcomes }
        )
        .is_err());
    }
    assert!(authorized_resources(
        refs.clone(),
        &request,
        CheckMomentReadPolicyResponse::default()
    )
    .is_err());
    for decision in [MomentReadDecision::Unspecified as i32, 99] {
        let outcomes = request
            .targets
            .iter()
            .map(|target| MomentReadPolicyOutcome {
                item_id: target.item_id.clone(),
                decision,
            })
            .collect();
        assert!(authorized_resources(
            refs.clone(),
            &request,
            CheckMomentReadPolicyResponse { outcomes }
        )
        .is_err());
    }
    assert!(policy_request(&vec![refs[0].clone(); 101]).is_err());
}

#[test]
fn private_social_policy_late_source_change_and_malformed_response_never_publish() {
    let executor = Arc::new(PolicyExecutor::default());
    let reader = binding(executor.clone());
    retained(&reader, 2);
    *executor.invalidate.lock().unwrap() = Some(reader.store.clone());
    assert!(reader
        .search_documents("needle", &[], None, 100, deadline(), &|| Ok(()))
        .is_err());
    executor.malformed.store(true, Ordering::Release);
    assert!(reader
        .search_documents("needle", &[], None, 100, deadline(), &|| Ok(()))
        .is_err());
    assert_eq!(executor.requests.lock().unwrap().len(), 2);
}

#[test]
fn private_social_policy_paging_advances_after_an_entire_denied_scan_page() {
    let executor = Arc::new(PolicyExecutor::default());
    let reader = binding(executor.clone());
    retained(&reader, 4);
    executor.denied.lock().unwrap().extend([
        "social-comment:comment-003".to_string(),
        "social-comment:comment-002".to_string(),
    ]);
    let page = reader
        .search_documents_page(
            "needle",
            &[ResultKind::SocialComment],
            None,
            2,
            deadline(),
            &|| Ok(()),
        )
        .unwrap();
    assert!(page.documents.is_empty());
    let (time, kind, id) = page.next_before.unwrap();
    assert_eq!(id, "comment-002");
    let page = reader
        .search_documents_page(
            "needle",
            &[ResultKind::SocialComment],
            Some((time, &kind, &id)),
            2,
            deadline(),
            &|| Ok(()),
        )
        .unwrap();
    assert_eq!(page.documents.len(), 2);
    assert!(page.next_before.is_none());
    let requests = executor.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests.iter().all(|request| request.targets.len() == 2));
}

#[test]
fn private_social_policy_shared_deadline_cancels_admission_or_response_and_expired_never_dispatches(
) {
    let executor = Arc::new(PolicyExecutor::default());
    let reader = binding(executor.clone());
    retained(&reader, 1);
    assert!(reader
        .search_documents("needle", &[], None, 100, Instant::now(), &|| Ok(()))
        .is_err());
    assert!(executor.requests.lock().unwrap().is_empty());
    executor.wait_for_cancel.store(true, Ordering::Release);
    let started = Instant::now();
    assert!(reader
        .search_documents(
            "needle",
            &[],
            None,
            100,
            started + Duration::from_millis(60),
            &|| Ok(())
        )
        .is_err());
    assert!(executor.cancelled.load(Ordering::Acquire));
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[test]
fn private_social_policy_callback_cancellation_reaches_inflight_request() {
    let executor = Arc::new(PolicyExecutor::default());
    let reader = binding(executor.clone());
    retained(&reader, 1);
    executor.wait_for_cancel.store(true, Ordering::Release);
    let checks = AtomicUsize::new(0);
    let check = || {
        if checks.fetch_add(1, Ordering::Relaxed) >= 12 {
            Err("query cancelled".to_string())
        } else {
            Ok(())
        }
    };
    assert!(reader
        .search_documents("needle", &[], None, 100, deadline(), &check)
        .is_err());
    assert!(executor.cancelled.load(Ordering::Acquire));
}

#[test]
fn private_social_policy_queued_store_read_observes_the_same_deadline() {
    let executor = Arc::new(PolicyExecutor::default());
    let reader = binding(executor.clone());
    retained(&reader, 1);
    let writer = reader.store.connection().unwrap();
    let started = Instant::now();
    assert!(reader
        .search_documents(
            "needle",
            &[],
            None,
            100,
            started + Duration::from_millis(30),
            &|| Ok(())
        )
        .is_err());
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(executor.requests.lock().unwrap().is_empty());
    drop(writer);
}

#[test]
fn private_social_policy_exact_anchor_has_parent_batch_bound_and_independent_comment_denial() {
    let executor = Arc::new(PolicyExecutor::default());
    let reader = binding(executor.clone());
    retained(&reader, 155);
    let window = reader
        .search_read_target_window("post-1", Some("comment-150"), 100, deadline(), &|| Ok(()))
        .unwrap()
        .unwrap();
    assert!(window.comment_projections.iter().any(|bytes| {
        serde_json::from_slice::<serde_json::Value>(bytes).unwrap()["comment_id"] == "comment-150"
    }));
    assert!(window.comment_projections.len() <= 99);
    let requests = executor.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0]
        .targets
        .iter()
        .all(|target| target.post_id == "post-1"));
    assert!(requests[0].targets.len() <= 100);
    drop(requests);
    executor
        .denied
        .lock()
        .unwrap()
        .insert("social-comment:comment-150".to_string());
    assert!(reader
        .search_read_target_window("post-1", Some("comment-150"), 5, deadline(), &|| Ok(()))
        .unwrap()
        .is_none());
    executor
        .denied
        .lock()
        .unwrap()
        .insert("social-post:post-1".to_string());
    assert!(reader
        .search_read_target_window("post-1", Some("comment-151"), 5, deadline(), &|| Ok(()))
        .unwrap()
        .is_none());
    assert_eq!(executor.requests.lock().unwrap().len(), 3);
}
