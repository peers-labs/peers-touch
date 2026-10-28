use std::sync::Arc;
use std::time::{Duration, Instant};

use search_core::cache::{ReadCache, ReadKey};
use search_core::{CancelToken, SearchError};

fn key() -> ReadKey {
    ReadKey {
        partition: "actor".into(),
        source: "source".into(),
        binding: "binding".into(),
        read_scope: "scope".into(),
        dependency: "one".into(),
        operation: "query".into(),
        semantic: vec![1],
    }
}

#[test]
fn last_subscriber_owns_cancellation_and_no_store_is_not_reusable() {
    let cache = Arc::new(ReadCache::default());
    let (first, operation) = cache
        .subscribe(key(), false, Duration::from_secs(1))
        .unwrap();
    let operation = operation.unwrap();
    let (second, leader) = cache
        .subscribe(key(), false, Duration::from_secs(1))
        .unwrap();
    assert!(leader.is_none());
    drop(first);
    operation.check().unwrap();
    operation
        .commit(vec![1, 2], Instant::now() + Duration::from_secs(1), true)
        .unwrap();
    assert_eq!(
        second
            .wait(&CancelToken::new(), Instant::now() + Duration::from_secs(1))
            .unwrap()
            .as_ref(),
        &[1, 2]
    );
    drop(second);
    assert!(operation.cancel.is_cancelled());
    let (_, new) = cache
        .subscribe(key(), false, Duration::from_secs(1))
        .unwrap();
    assert!(new.is_some());
}

#[test]
fn invalidation_fence_survives_empty_payload_map_and_late_commit() {
    let cache = Arc::new(ReadCache::default());
    let (subscription, old) = cache
        .subscribe(key(), false, Duration::from_secs(1))
        .unwrap();
    let old = old.unwrap();
    cache.invalidate(|_| true);
    assert_eq!(
        subscription.wait(&CancelToken::new(), Instant::now() + Duration::from_secs(1)),
        Err(SearchError::SourceChanged)
    );
    let (new_subscription, new) = cache
        .subscribe(key(), false, Duration::from_secs(1))
        .unwrap();
    let new = new.unwrap();
    new.commit(vec![2], Instant::now() + Duration::from_secs(1), false)
        .unwrap();
    assert!(old
        .commit(vec![1], Instant::now() + Duration::from_secs(1), false)
        .is_err());
    assert_eq!(
        new_subscription
            .wait(&CancelToken::new(), Instant::now() + Duration::from_secs(1))
            .unwrap()
            .as_ref(),
        &[2]
    );
}

#[test]
fn oversized_keys_and_payloads_are_rejected_before_retention() {
    let cache = Arc::new(ReadCache::default());
    let mut oversized = key();
    oversized.semantic = vec![0; 1024 * 1024];
    assert!(matches!(
        cache.subscribe(oversized, false, Duration::from_secs(1)),
        Err(SearchError::SourceUnavailable(_))
    ));
    let (_subscription, operation) = cache
        .subscribe(key(), false, Duration::from_secs(1))
        .unwrap();
    assert!(operation
        .unwrap()
        .commit(
            vec![0; 2 * 1024 * 1024 + 1],
            Instant::now() + Duration::from_secs(1),
            false
        )
        .is_err());
}
