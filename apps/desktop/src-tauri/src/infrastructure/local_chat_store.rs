use super::storage::key_provider::PlatformKeyProvider;
use super::storage::get_database_key_version;
use super::storage::open_database;
use super::storage::rotate_database_key;
use crate::domain::storage::database::DatabaseOpenSpec;
use crate::model::chat;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatRecord {
    pub scope: String,
    pub conversation_id: String,
    pub message_id: String,
    pub sender_did: String,
    pub content: String,
    pub sent_at: i64,
}

fn open_connection(user_scope: &str) -> Result<Connection, String> {
    let spec = DatabaseOpenSpec::new_chat_main(user_scope.to_string());
    let provider = PlatformKeyProvider::new();
    let conn = open_database(&spec, &provider).map_err(|e| format!("{e:?}"))?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chat_messages (
            scope TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            message_id TEXT NOT NULL PRIMARY KEY,
            sender_did TEXT NOT NULL,
            content TEXT NOT NULL,
            sent_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_messages_scope_sent ON chat_messages(scope, sent_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_scope_conv_sent ON chat_messages(scope, conversation_id, sent_at DESC);
        CREATE TABLE IF NOT EXISTS chat_sync_cursor (
            scope TEXT NOT NULL PRIMARY KEY,
            cursor TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(
            message_id UNINDEXED,
            scope UNINDEXED,
            conversation_id UNINDEXED,
            sender_did UNINDEXED,
            content
        );",
    )
    .map_err(|e| e.to_string())
}

fn upsert_record(conn: &Connection, item: &LocalChatRecord) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chat_messages(scope, conversation_id, message_id, sender_did, content, sent_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(message_id) DO UPDATE SET
           scope=excluded.scope,
           conversation_id=excluded.conversation_id,
           sender_did=excluded.sender_did,
           content=excluded.content,
           sent_at=excluded.sent_at",
        params![
            item.scope,
            item.conversation_id,
            item.message_id,
            item.sender_did,
            item.content,
            item.sent_at
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chat_messages_fts WHERE message_id = ?1", params![item.message_id])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chat_messages_fts(message_id, scope, conversation_id, sender_did, content)
         VALUES(?1, ?2, ?3, ?4, ?5)",
        params![item.message_id, item.scope, item.conversation_id, item.sender_did, item.content],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn ingest_friend_payload(user_scope: &str, payload: &Value) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    if let Some(messages) = payload.get("messages").and_then(|v| v.as_array()) {
        for m in messages {
            let record = LocalChatRecord {
                scope: "friend".to_string(),
                conversation_id: m.get("session_ulid").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                message_id: m.get("ulid").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                sender_did: m.get("sender_did").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                content: m.get("content").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                sent_at: m.get("sent_at").and_then(|v| v.as_i64()).unwrap_or(0),
            };
            if !record.message_id.is_empty() {
                upsert_record(&conn, &record)?;
            }
        }
    }
    if let Some(message) = payload.get("message").and_then(|v| v.as_object()) {
        let record = LocalChatRecord {
            scope: "friend".to_string(),
            conversation_id: message.get("session_ulid").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            message_id: message.get("ulid").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            sender_did: message.get("sender_did").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            content: message.get("content").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            sent_at: message.get("sent_at").and_then(|v| v.as_i64()).unwrap_or(0),
        };
        if !record.message_id.is_empty() {
            upsert_record(&conn, &record)?;
        }
    }
    Ok(())
}

pub fn ingest_group_payload(user_scope: &str, payload: &Value) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    if let Some(messages) = payload.get("messages").and_then(|v| v.as_array()) {
        for m in messages {
            let record = LocalChatRecord {
                scope: "group".to_string(),
                conversation_id: m.get("group_ulid").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                message_id: m.get("ulid").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                sender_did: m.get("sender_did").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                content: m.get("content").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                sent_at: m.get("sent_at").and_then(|v| v.as_i64()).unwrap_or(0),
            };
            if !record.message_id.is_empty() {
                upsert_record(&conn, &record)?;
            }
        }
    }
    if let Some(message) = payload.get("message").and_then(|v| v.as_object()) {
        let record = LocalChatRecord {
            scope: "group".to_string(),
            conversation_id: message.get("group_ulid").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            message_id: message.get("ulid").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            sender_did: message.get("sender_did").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            content: message.get("content").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            sent_at: message.get("sent_at").and_then(|v| v.as_i64()).unwrap_or(0),
        };
        if !record.message_id.is_empty() {
            upsert_record(&conn, &record)?;
        }
    }
    Ok(())
}

fn timestamp_to_millis(ts: &Option<prost_types::Timestamp>) -> i64 {
    ts.as_ref()
        .map(|t| t.seconds * 1000 + t.nanos as i64 / 1_000_000)
        .unwrap_or(0)
}

pub fn ingest_friend_messages_proto(user_scope: &str, messages: &[chat::FriendChatMessage]) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    for m in messages {
        let record = LocalChatRecord {
            scope: "friend".to_string(),
            conversation_id: m.session_ulid.clone(),
            message_id: m.ulid.clone(),
            sender_did: m.sender_did.clone(),
            content: m.content.clone(),
            sent_at: timestamp_to_millis(&m.sent_at),
        };
        if !record.message_id.is_empty() {
            upsert_record(&conn, &record)?;
        }
    }
    Ok(())
}

pub fn ingest_group_messages_proto(user_scope: &str, messages: &[chat::GroupMessage]) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    for m in messages {
        let record = LocalChatRecord {
            scope: "group".to_string(),
            conversation_id: m.group_ulid.clone(),
            message_id: m.ulid.clone(),
            sender_did: m.sender_did.clone(),
            content: m.content.clone(),
            sent_at: timestamp_to_millis(&m.sent_at),
        };
        if !record.message_id.is_empty() {
            upsert_record(&conn, &record)?;
        }
    }
    Ok(())
}

pub fn search_local(user_scope: &str, scope: &str, query: &str, limit: usize) -> Result<Vec<LocalChatRecord>, String> {
    let conn = open_connection(user_scope)?;
    let mut stmt = conn
        .prepare(
            "SELECT m.scope, m.conversation_id, m.message_id, m.sender_did, m.content, m.sent_at
             FROM chat_messages_fts f
             JOIN chat_messages m ON m.message_id = f.message_id
             WHERE f.scope = ?1 AND chat_messages_fts MATCH ?2
             ORDER BY m.sent_at DESC
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![scope, query, limit as i64], |row| {
            Ok(LocalChatRecord {
                scope: row.get(0)?,
                conversation_id: row.get(1)?,
                message_id: row.get(2)?,
                sender_did: row.get(3)?,
                content: row.get(4)?,
                sent_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn set_sync_cursor(user_scope: &str, scope: &str, cursor: &str) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let now = chrono_now();
    conn.execute(
        "INSERT INTO chat_sync_cursor(scope, cursor, updated_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(scope) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at",
        params![scope, cursor, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_sync_cursor(user_scope: &str, scope: &str) -> Result<Option<String>, String> {
    let conn = open_connection(user_scope)?;
    let mut stmt = conn
        .prepare("SELECT cursor FROM chat_sync_cursor WHERE scope = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![scope]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let cursor: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(Some(cursor))
    } else {
        Ok(None)
    }
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn get_chat_key_version(user_scope: &str) -> Result<Option<i32>, String> {
    let spec = DatabaseOpenSpec::new_chat_main(user_scope.to_string());
    let provider = PlatformKeyProvider::new();
    get_database_key_version(&spec, &provider).map_err(|e| format!("{e:?}"))
}

pub fn rotate_chat_key(user_scope: &str, next_version: i32) -> Result<i32, String> {
    let spec = DatabaseOpenSpec::new_chat_main(user_scope.to_string());
    let provider = PlatformKeyProvider::new();
    rotate_database_key(&spec, &provider, next_version).map_err(|e| format!("{e:?}"))
}
