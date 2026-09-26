use super::adapter::MobileMessagingStore;
use messaging_core::proto::chat::ChatStorageOperationState;
use messaging_core::storage_governance::cache::{
    CacheCleanupItem, CacheCleanupItemState, CacheCleanupJournalRepository, CacheCleanupOperation,
};
use messaging_core::storage_governance::conversation_clear::{
    clear_conversation, ConversationClearInput,
};
use messaging_core::storage_governance::retention::RetentionRepository;
use std::fs;

#[test]
fn mobile_storage_logical_usage_reads_conversation_owned_plaintext_bytes() {
    let root =
        std::env::temp_dir().join(format!("peers-touch-mobile-storage-{}", ulid::Ulid::new()));
    fs::create_dir_all(&root).unwrap();
    let database_path = root.join("chat.sqlite3");
    let store = MobileMessagingStore::open(&database_path, &[9_u8; 32]).unwrap();
    store
        .execute_storage_test_sql(
            "INSERT INTO messaging_conversations(
                conversation_id, authority_station_id, federation_id, kind,
                name, owner_ptid, membership_epoch, mls_epoch, active,
                updated_at_unix_ms
             ) VALUES('conversation-1', 'station-1', 'federation-1', 1,
                'Alice', 'ptid:alice', 1, 0, 1, 100);
             INSERT INTO messaging_message_projections(
                conversation_id, event_id, event_sequence, message_id,
                sender_ptid, sender_device_id, plaintext, delivery_state,
                committed_at_unix_ms
             ) VALUES('conversation-1', 'event-1', 1, 'message-1',
                'ptid:alice', 'device-1', 'hello', 'committed', 200);",
        )
        .unwrap();

    let usage = store.storage_logical_usage().unwrap();

    assert_eq!(usage.len(), 1);
    assert_eq!(usage[0].conversation_name, "Alice");
    assert_eq!(usage[0].conversation_kind, 1);
    assert!(usage[0].message_bytes >= 5);
    assert_eq!(usage[0].last_activity_unix_ms, 200);
    drop(store);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn mobile_cache_cleanup_journal_round_trips_resumable_items() {
    let root = std::env::temp_dir().join(format!(
        "peers-touch-mobile-cache-journal-{}",
        ulid::Ulid::new()
    ));
    fs::create_dir_all(&root).unwrap();
    let store = MobileMessagingStore::open(&root.join("chat.sqlite3"), &[9_u8; 32]).unwrap();
    let operation = CacheCleanupOperation {
        operation_id: "cache-operation-1".to_string(),
        scope_revision: "scope-1".to_string(),
        state: ChatStorageOperationState::Planned,
        estimated_reclaimable_bytes: 2048,
        physical_bytes_before: 8192,
        physical_bytes_after: None,
        last_error_code: None,
        created_at_unix_ms: 100,
        updated_at_unix_ms: 100,
    };
    let item = CacheCleanupItem {
        item_id: "cache-item-1".to_string(),
        target_ref: root.join("cache-item").display().to_string(),
        expected_size_bytes: 2048,
        expected_digest: [3; 32],
        state: CacheCleanupItemState::Pending,
        last_error_code: None,
    };

    store
        .create_cache_cleanup(&operation, std::slice::from_ref(&item))
        .unwrap();
    assert_eq!(
        store.load_resumable_cache_cleanup("scope-1").unwrap(),
        Some(operation.clone())
    );
    assert_eq!(
        store.load_cache_cleanup_items("cache-operation-1").unwrap(),
        vec![item.clone()]
    );

    store
        .update_cache_cleanup_item(
            "cache-operation-1",
            "cache-item-1",
            CacheCleanupItemState::Deleted,
            None,
            200,
        )
        .unwrap();
    let completed = store
        .update_cache_cleanup_operation(
            "cache-operation-1",
            ChatStorageOperationState::Succeeded,
            Some(6144),
            None,
            200,
        )
        .unwrap();

    assert_eq!(completed.state, ChatStorageOperationState::Succeeded);
    assert_eq!(completed.physical_bytes_after, Some(6144));
    assert_eq!(
        store.load_cache_cleanup_items("cache-operation-1").unwrap()[0].state,
        CacheCleanupItemState::Deleted
    );
    assert!(store
        .load_resumable_cache_cleanup("scope-1")
        .unwrap()
        .is_none());
    drop(store);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn mobile_conversation_clear_commits_floor_and_removes_plaintext_projection() {
    let root = std::env::temp_dir().join(format!(
        "peers-touch-mobile-conversation-clear-{}",
        ulid::Ulid::new()
    ));
    fs::create_dir_all(&root).unwrap();
    let store = MobileMessagingStore::open(&root.join("chat.sqlite3"), &[9_u8; 32]).unwrap();
    let scope = messaging_core::proto::chat::ChatStorageScope {
        station_peer_id: "station-five".to_string(),
        actor_ptid: "ptid:alice".to_string(),
        device_id: "alice-device".to_string(),
    };
    let hash_one = "01".repeat(32);
    let hash_two = "02".repeat(32);
    store
        .execute_storage_test_sql(&format!(
            "INSERT INTO messaging_device_identity(
                id, ptid, device_id, device_signing_seed,
                actor_identity_public_key, actor_identity_key_fingerprint,
                device_signing_public_key, actor_cross_signature,
                signing_key_id, profile_version
             ) VALUES(
                1, 'ptid:alice', 'alice-device', zeroblob(32),
                zeroblob(32), zeroblob(32), zeroblob(32), zeroblob(64),
                'key-1', 1
             );
             INSERT INTO messaging_conversations(
                conversation_id, authority_station_id, federation_id, kind,
                name, description, owner_ptid, membership_epoch, mls_epoch,
                active, updated_at_unix_ms
             ) VALUES(
                'conversation-1', 'station-five', 'federation-1', 1,
                'Alice', '', 'ptid:alice', 1, 0, 1, 100
             );
             INSERT INTO messaging_authority_events(
                conversation_id, event_id, event_sequence, event_hash,
                committed_at_unix_ms
             ) VALUES
                ('conversation-1', 'event-1', 1, X'{hash_one}', 100),
                ('conversation-1', 'event-2', 2, X'{hash_two}', 200);
             INSERT INTO messaging_authority_heads(
                conversation_id, event_sequence, event_hash, updated_at_unix_ms
             ) VALUES('conversation-1', 2, X'{hash_two}', 200);
             INSERT INTO messaging_message_projections(
                conversation_id, event_id, event_sequence, message_id,
                sender_ptid, sender_device_id, plaintext, delivery_state,
                committed_at_unix_ms
             ) VALUES
                ('conversation-1', 'event-1', 1, 'message-1',
                 'ptid:bob', 'bob-device', 'first plaintext', 'consumed', 100),
                ('conversation-1', 'event-2', 2, 'message-2',
                 'ptid:bob', 'bob-device', 'second plaintext', 'consumed', 200);
             INSERT INTO messaging_consumption_markers(
                item_id, event_id, conversation_id, payload_sha256,
                consumed_at_unix_ms
             ) VALUES
                ('item-1', 'event-1', 'conversation-1', zeroblob(32), 100),
                ('item-2', 'event-2', 'conversation-1', zeroblob(32), 200);
             INSERT INTO messaging_message_search_fts(
                conversation_id, message_id, plaintext, attachment_filenames
             ) VALUES
                ('conversation-1', 'message-1', 'first plaintext', ''),
                ('conversation-1', 'message-2', 'second plaintext', '');"
        ))
        .unwrap();

    let progress = clear_conversation(
        &store,
        ConversationClearInput {
            scope: scope.clone(),
            scope_revision: "scope-1".to_string(),
            conversation_id: "conversation-1".to_string(),
            physical_bytes_before: fs::metadata(root.join("chat.sqlite3")).unwrap().len(),
            now_unix_ms: 300,
        },
    )
    .unwrap();

    assert_eq!(
        progress.commit.operation.state,
        ChatStorageOperationState::Compacting
    );
    assert_eq!(progress.commit.pruned_projection_count, 2);
    assert!(store
        .conversation_message_projections("conversation-1")
        .unwrap()
        .is_empty());
    assert!(store
        .search_message_projections("conversation-1", "plaintext", None, 10)
        .unwrap()
        .is_empty());
    let floor = store.load_retention_floors(&scope).unwrap();
    assert_eq!(floor.len(), 1);
    assert_eq!(floor[0].pruned_through_sequence, 2);
    assert_eq!(floor[0].authority_event_hash, [2; 32]);
    drop(store);
    fs::remove_dir_all(root).unwrap();
}
