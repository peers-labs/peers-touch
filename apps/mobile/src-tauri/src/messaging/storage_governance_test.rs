use super::adapter::MobileMessagingStore;
use std::fs;

#[test]
fn mobile_storage_logical_usage_reads_conversation_owned_plaintext_bytes() {
    let root = std::env::temp_dir().join(format!(
        "peers-touch-mobile-storage-{}",
        ulid::Ulid::new()
    ));
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
