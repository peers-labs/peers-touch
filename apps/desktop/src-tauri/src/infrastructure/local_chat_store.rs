use super::storage::get_database_key_version;
use super::storage::key_provider::PlatformKeyProvider;
use super::storage::open_database;
use super::storage::rotate_database_key;
use crate::domain::storage::database::DatabaseOpenSpec;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatRecord {
    pub scope: String,
    pub conversation_id: String,
    pub message_id: String,
    pub sender_ptid: String,
    pub content: String,
    pub reply_to_ulid: String,
    pub thread_root_ulid: String,
    pub sent_at: i64,
}

// Per-user-scope connection pool.
//
// Why a pool exists:
//   Each call to `open_database` triggers SQLCipher's PBKDF2 key
//   derivation plus WAL setup plus our schema-migration scan. On the
//   chat surface's cold path we hit `open_connection` 14+ times per
//   first paint (one per session for `friendChatSync`, one per
//   ingest, one per cursor read). Re-paying the open cost on every
//   call is the dominant contributor to the "first click on chat is
//   laggy" UX bug. Pooling collapses those repeats to a single open
//   per user_scope per process lifetime.
//
// Concurrency:
//   We hold each cached Connection inside a `Mutex` because
//   rusqlite's `Connection` is `!Sync`. Multiple readers will
//   serialize on the mutex; SQLite WAL handles concurrent reads at
//   the engine layer when separate connections exist, but for our
//   workload (a few foreground UI calls and one background sync at
//   a time) the mutex contention is negligible compared to the
//   open-cost it replaces.
//
// Invalidation:
//   `rotate_chat_key` evicts the cached connection for the affected
//   scope so the next call re-opens with the rotated key. Without
//   eviction the pool would serve a Connection holding the old
//   passphrase and every subsequent statement would fail.
fn pool() -> &'static Mutex<HashMap<String, Arc<Mutex<Connection>>>> {
    static POOL: OnceLock<Mutex<HashMap<String, Arc<Mutex<Connection>>>>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Lazy, refcounted handle to the pooled SQLCipher connection for a
/// given `user_scope`. Call sites use it like a regular Connection
/// once they `lock()` — the guard derefs to `Connection`.
pub struct ChatConn {
    arc: Arc<Mutex<Connection>>,
}

impl ChatConn {
    /// Acquire exclusive access to the underlying Connection. The
    /// guard releases the lock on drop; hold it only for the
    /// duration of a single logical query/transaction.
    pub fn lock(&self) -> MutexGuard<'_, Connection> {
        self.arc
            .lock()
            .expect("local_chat_store conn pool poisoned")
    }
}

fn open_connection(user_scope: &str) -> Result<ChatConn, String> {
    {
        let map = pool().lock().expect("local_chat_store pool poisoned");
        if let Some(arc) = map.get(user_scope) {
            return Ok(ChatConn { arc: arc.clone() });
        }
    }
    // Cold path: actually open + migrate, then publish to the pool.
    // We deliberately drop the pool lock during open_database so a
    // slow keychain RPC on one scope does not stall callers for
    // *other* scopes. The cost is that two threads racing on the
    // same scope might both reach this branch; whoever wins the
    // second pool lock wins and the loser's open cost is wasted but
    // benign (no migration is destructive).
    let spec = DatabaseOpenSpec::new_chat_main(user_scope.to_string());
    let provider = PlatformKeyProvider::shared();
    let conn = open_database(&spec, provider).map_err(|e| {
        let detail = format!("{e:?}");
        tracing::error!(
            user_scope = user_scope,
            domain = %spec.domain,
            profile = %spec.profile,
            error = %detail,
            "local_chat_store: open_database failed"
        );
        format!("open_database failed for chat/main user_scope={user_scope}: {detail}")
    })?;
    migrate(&conn).map_err(|e| {
        tracing::error!(user_scope = user_scope, error = %e, "local_chat_store: migrate failed");
        format!("migrate failed for chat/main user_scope={user_scope}: {e}")
    })?;
    let arc = Arc::new(Mutex::new(conn));
    let mut map = pool().lock().expect("local_chat_store pool poisoned");
    let entry = map
        .entry(user_scope.to_string())
        .or_insert_with(|| arc.clone());
    Ok(ChatConn { arc: entry.clone() })
}

/// Drop the cached SQLCipher connection for `user_scope`. The next
/// `open_connection(user_scope)` will reopen + remigrate. Used after
/// a key rotation so the pool does not serve a Connection still
/// bound to the old passphrase.
fn invalidate_pool(user_scope: &str) {
    if let Ok(mut map) = pool().lock() {
        map.remove(user_scope);
    }
}

/// One-time migrations tracked per chat DB (per `user_scope`).
const DROP_LEGACY_DIRECT_STORAGE_V1: &str = "drop_legacy_direct_storage_v1";
const DROP_LEGACY_MLS_STORAGE_V1: &str = "drop_legacy_mls_storage_v1";

fn migrate(conn: &Connection) -> Result<(), String> {
    migrate_schema(conn)?;
    apply_one_time_migrations(conn)?;
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, ddl: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for row in rows {
        if row.map_err(|e| e.to_string())? == column {
            return Ok(());
        }
    }
    conn.execute_batch(ddl).map_err(|e| e.to_string())
}

fn migrate_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chat_messages (
            scope TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            message_id TEXT NOT NULL PRIMARY KEY,
            sender_ptid TEXT NOT NULL,
            content TEXT NOT NULL,
            reply_to_ulid TEXT NOT NULL DEFAULT '',
            thread_root_ulid TEXT NOT NULL DEFAULT '',
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
            sender_ptid UNINDEXED,
            content
        );
        -- Group message payloads remain opaque ciphertext; Messaging Core owns
        -- all OpenMLS state through its repository.
        CREATE TABLE IF NOT EXISTS group_messages (
            ulid               TEXT    NOT NULL PRIMARY KEY,
            group_ulid         TEXT    NOT NULL DEFAULT '',
            sender_ptid         TEXT    NOT NULL DEFAULT '',
            content            TEXT    NOT NULL DEFAULT '',
            encrypted_payload  BLOB,
            reply_to_ulid      TEXT    NOT NULL DEFAULT '',
            thread_root_ulid   TEXT    NOT NULL DEFAULT '',
            sent_at            INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS chat_applied_migrations (
            name        TEXT PRIMARY KEY,
            applied_at  INTEGER NOT NULL
        );",
    )
    .map_err(|e| e.to_string())?;
    ensure_column(
        conn,
        "chat_messages",
        "reply_to_ulid",
        "ALTER TABLE chat_messages ADD COLUMN reply_to_ulid TEXT NOT NULL DEFAULT '';",
    )?;
    ensure_column(
        conn,
        "group_messages",
        "reply_to_ulid",
        "ALTER TABLE group_messages ADD COLUMN reply_to_ulid TEXT NOT NULL DEFAULT '';",
    )?;
    ensure_column(
        conn,
        "chat_messages",
        "thread_root_ulid",
        "ALTER TABLE chat_messages ADD COLUMN thread_root_ulid TEXT NOT NULL DEFAULT '';",
    )?;
    ensure_column(
        conn,
        "group_messages",
        "thread_root_ulid",
        "ALTER TABLE group_messages ADD COLUMN thread_root_ulid TEXT NOT NULL DEFAULT '';",
    )?;
    backfill_local_thread_roots(conn)
}

fn apply_one_time_migrations(conn: &Connection) -> Result<(), String> {
    apply_drop_legacy_mls_storage_v1(conn)?;
    apply_drop_legacy_direct_storage_v1(conn)?;
    Ok(())
}

fn apply_drop_legacy_mls_storage_v1(conn: &Connection) -> Result<(), String> {
    let already: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_applied_migrations WHERE name = ?1",
            params![DROP_LEGACY_MLS_STORAGE_V1],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if already > 0 {
        return Ok(());
    }

    // Remove dependent transition records before the root MLS state and identity.
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "DROP TABLE IF EXISTS crypto_mls_recipient_event_buffer;
         DROP TABLE IF EXISTS crypto_mls_recipient_delivery_buffer;
         DROP TABLE IF EXISTS crypto_mls_recipient_applied_event;
         DROP TABLE IF EXISTS crypto_mls_recipient_applied;
         DROP TABLE IF EXISTS crypto_mls_local_accepted_transition;
         DROP TABLE IF EXISTS crypto_mls_pending_transition;
         DROP TABLE IF EXISTS crypto_mls_recipient_head;
         DROP TABLE IF EXISTS crypto_mls_state;
         DROP TABLE IF EXISTS crypto_mls_join_provider_pool;
         DROP TABLE IF EXISTS crypto_mls_identity;",
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO chat_applied_migrations(name, applied_at) VALUES (?1, ?2)",
            params![DROP_LEGACY_MLS_STORAGE_V1, chrono_now()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    tracing::info!(
        migration = DROP_LEGACY_MLS_STORAGE_V1,
        "local_chat_store: removed legacy MLS storage tables"
    );
    Ok(())
}

fn apply_drop_legacy_direct_storage_v1(conn: &Connection) -> Result<(), String> {
    let already: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_applied_migrations WHERE name = ?1",
            params![DROP_LEGACY_DIRECT_STORAGE_V1],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if already > 0 {
        return Ok(());
    }

    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "DROP TABLE IF EXISTS direct_skipped_message_keys;
             DROP TABLE IF EXISTS direct_sessions;
             DROP TABLE IF EXISTS crypto_skipped_keys;
             DROP TABLE IF EXISTS crypto_session_delivery;
             DROP TABLE IF EXISTS crypto_sessions;
             DROP TABLE IF EXISTS crypto_outbox;
             DROP TABLE IF EXISTS crypto_one_time_prekey;
             DROP TABLE IF EXISTS crypto_signed_prekey;",
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO chat_applied_migrations(name, applied_at) VALUES (?1, ?2)",
            params![DROP_LEGACY_DIRECT_STORAGE_V1, chrono_now()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    tracing::info!(
        migration = DROP_LEGACY_DIRECT_STORAGE_V1,
        "local_chat_store: removed legacy Direct storage tables"
    );
    Ok(())
}

fn upsert_record(conn: &Connection, item: &LocalChatRecord) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chat_messages(scope, conversation_id, message_id, sender_ptid, content, reply_to_ulid, thread_root_ulid, sent_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(message_id) DO UPDATE SET
           scope=excluded.scope,
           conversation_id=excluded.conversation_id,
           sender_ptid=excluded.sender_ptid,
           content=excluded.content,
           reply_to_ulid=excluded.reply_to_ulid,
           thread_root_ulid=excluded.thread_root_ulid,
           sent_at=excluded.sent_at",
        params![
            item.scope,
            item.conversation_id,
            item.message_id,
            item.sender_ptid,
            item.content,
            item.reply_to_ulid,
            item.thread_root_ulid,
            item.sent_at
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM chat_messages_fts WHERE message_id = ?1",
        params![item.message_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chat_messages_fts(message_id, scope, conversation_id, sender_ptid, content)
         VALUES(?1, ?2, ?3, ?4, ?5)",
        params![
            item.message_id,
            item.scope,
            item.conversation_id,
            item.sender_ptid,
            item.content
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn upsert_plaintext_records(
    user_scope: &str,
    records: &[LocalChatRecord],
) -> Result<usize, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let mut indexed = 0usize;
    for record in records {
        if record.message_id.trim().is_empty()
            || record.conversation_id.trim().is_empty()
            || record.content.trim().is_empty()
        {
            continue;
        }
        match record.scope.as_str() {
            "friend" | "group" => {
                upsert_record(&conn, record)?;
                indexed += 1;
            }
            _ => {}
        }
    }
    Ok(indexed)
}

fn json_string(value: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(s) = value.get(*key).and_then(|v| v.as_str()) {
            return s.to_string();
        }
    }
    String::new()
}

fn backfill_local_thread_roots(conn: &Connection) -> Result<(), String> {
    #[derive(Clone)]
    struct Row {
        id: String,
        reply_to_ulid: String,
        thread_root_ulid: String,
    }

    fn resolve(
        id: &str,
        rows: &HashMap<String, Row>,
        resolving: &mut HashMap<String, bool>,
        resolved: &mut HashMap<String, String>,
    ) -> String {
        if let Some(cached) = resolved.get(id) {
            return cached.clone();
        }
        let Some(row) = rows.get(id) else {
            return id.to_string();
        };
        if !row.thread_root_ulid.is_empty() {
            return row.thread_root_ulid.clone();
        }
        if row.reply_to_ulid.is_empty() || resolving.get(id).copied().unwrap_or(false) {
            return String::new();
        }
        resolving.insert(id.to_string(), true);
        let root = if rows.contains_key(&row.reply_to_ulid) {
            let parent_root = resolve(&row.reply_to_ulid, rows, resolving, resolved);
            if parent_root.is_empty() {
                row.reply_to_ulid.clone()
            } else {
                parent_root
            }
        } else {
            row.reply_to_ulid.clone()
        };
        resolving.insert(id.to_string(), false);
        resolved.insert(id.to_string(), root.clone());
        root
    }

    fn backfill_table(conn: &Connection, table: &str, id_column: &str) -> Result<(), String> {
        let select_sql = format!(
            "SELECT {id_column}, reply_to_ulid, thread_root_ulid
             FROM {table}
             WHERE reply_to_ulid != ''
             ORDER BY sent_at ASC, {id_column} ASC"
        );
        let mut stmt = conn.prepare(&select_sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Row {
                    id: row.get(0)?,
                    reply_to_ulid: row.get(1)?,
                    thread_root_ulid: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut by_id = HashMap::new();
        for row in rows {
            let row = row.map_err(|e| e.to_string())?;
            by_id.insert(row.id.clone(), row);
        }
        if by_id.is_empty() {
            return Ok(());
        }

        let update_sql = format!("UPDATE {table} SET thread_root_ulid = ?1 WHERE {id_column} = ?2");
        let mut resolving = HashMap::new();
        let mut resolved = HashMap::new();
        for id in by_id.keys() {
            let root = resolve(id, &by_id, &mut resolving, &mut resolved);
            let Some(row) = by_id.get(id) else {
                continue;
            };
            if root.is_empty() || root == row.thread_root_ulid {
                continue;
            }
            conn.execute(&update_sql, params![root, id])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    backfill_table(conn, "chat_messages", "message_id")?;
    backfill_table(conn, "group_messages", "ulid")?;
    Ok(())
}

pub fn ingest_friend_payload(user_scope: &str, payload: &Value) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    if let Some(messages) = payload.get("messages").and_then(|v| v.as_array()) {
        for m in messages {
            let record = LocalChatRecord {
                scope: "friend".to_string(),
                conversation_id: json_string(m, &["session_ulid", "sessionUlid"]),
                message_id: json_string(m, &["ulid"]),
                sender_ptid: json_string(m, &["sender_ptid", "senderPtid"]),
                content: json_string(m, &["content"]),
                reply_to_ulid: json_string(m, &["reply_to_ulid", "replyToUlid"]),
                thread_root_ulid: json_string(m, &["thread_root_ulid", "threadRootUlid"]),
                sent_at: m.get("sent_at").and_then(|v| v.as_i64()).unwrap_or(0),
            };
            if !record.message_id.is_empty() {
                upsert_record(&conn, &record)?;
            }
        }
    }
    if let Some(message) = payload.get("message").and_then(|v| v.as_object()) {
        let message_value = Value::Object(message.clone());
        let record = LocalChatRecord {
            scope: "friend".to_string(),
            conversation_id: json_string(&message_value, &["session_ulid", "sessionUlid"]),
            message_id: json_string(&message_value, &["ulid"]),
            sender_ptid: json_string(&message_value, &["sender_ptid", "senderPtid"]),
            content: json_string(&message_value, &["content"]),
            reply_to_ulid: json_string(&message_value, &["reply_to_ulid", "replyToUlid"]),
            thread_root_ulid: json_string(&message_value, &["thread_root_ulid", "threadRootUlid"]),
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
    let conn = conn.lock();
    if let Some(messages) = payload.get("messages").and_then(|v| v.as_array()) {
        for m in messages {
            let record = LocalChatRecord {
                scope: "group".to_string(),
                conversation_id: json_string(m, &["group_ulid", "groupUlid"]),
                message_id: json_string(m, &["ulid"]),
                sender_ptid: json_string(m, &["sender_ptid", "senderPtid"]),
                content: json_string(m, &["content"]),
                reply_to_ulid: json_string(m, &["reply_to_ulid", "replyToUlid"]),
                thread_root_ulid: json_string(m, &["thread_root_ulid", "threadRootUlid"]),
                sent_at: m.get("sent_at").and_then(|v| v.as_i64()).unwrap_or(0),
            };
            if !record.message_id.is_empty() {
                upsert_record(&conn, &record)?;
            }
        }
    }
    if let Some(message) = payload.get("message").and_then(|v| v.as_object()) {
        let message_value = Value::Object(message.clone());
        let record = LocalChatRecord {
            scope: "group".to_string(),
            conversation_id: json_string(&message_value, &["group_ulid", "groupUlid"]),
            message_id: json_string(&message_value, &["ulid"]),
            sender_ptid: json_string(&message_value, &["sender_ptid", "senderPtid"]),
            content: json_string(&message_value, &["content"]),
            reply_to_ulid: json_string(&message_value, &["reply_to_ulid", "replyToUlid"]),
            thread_root_ulid: json_string(&message_value, &["thread_root_ulid", "threadRootUlid"]),
            sent_at: message.get("sent_at").and_then(|v| v.as_i64()).unwrap_or(0),
        };
        if !record.message_id.is_empty() {
            upsert_record(&conn, &record)?;
        }
    }
    Ok(())
}

fn merge_desc_by_sent_at(
    a: Vec<LocalChatRecord>,
    b: Vec<LocalChatRecord>,
    limit: usize,
) -> Vec<LocalChatRecord> {
    let mut out = Vec::with_capacity(limit.min(a.len() + b.len()));
    let mut i = 0usize;
    let mut j = 0usize;
    while out.len() < limit {
        let take_a = match (i < a.len(), j < b.len()) {
            (true, true) => a[i].sent_at >= b[j].sent_at,
            (true, false) => true,
            (false, true) => false,
            (false, false) => break,
        };
        if take_a {
            out.push(a[i].clone());
            i += 1;
        } else {
            out.push(b[j].clone());
            j += 1;
        }
    }
    out
}

fn search_local_single(
    conn: &Connection,
    scope: &str,
    conversation_id: Option<&str>,
    query: &str,
    limit: usize,
) -> Result<Vec<LocalChatRecord>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let fts_query = fts_phrase_query(trimmed);
    let like_pattern = like_contains_pattern(trimmed);
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    if let Some(fts) = fts_query.as_deref() {
        let mut stmt = conn
            .prepare(
                "SELECT m.scope, m.conversation_id, m.message_id, m.sender_ptid, m.content, m.reply_to_ulid, m.thread_root_ulid, m.sent_at
                 FROM chat_messages_fts f
                 JOIN chat_messages m ON m.message_id = f.message_id
                 WHERE f.scope = ?1
                   AND (?2 = '' OR m.conversation_id = ?2)
                   AND chat_messages_fts MATCH ?3
                 ORDER BY m.sent_at DESC
                 LIMIT ?4",
            )
            .map_err(|e| e.to_string())?;
        let conv = conversation_id
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .unwrap_or("");
        let rows = stmt
            .query_map(params![scope, conv, fts, limit as i64], |row| {
                Ok(LocalChatRecord {
                    scope: row.get(0)?,
                    conversation_id: row.get(1)?,
                    message_id: row.get(2)?,
                    sender_ptid: row.get(3)?,
                    content: row.get(4)?,
                    reply_to_ulid: row.get(5)?,
                    thread_root_ulid: row.get(6)?,
                    sent_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let record = row.map_err(|e| e.to_string())?;
            seen.insert(record.message_id.clone());
            out.push(record);
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT m.scope, m.conversation_id, m.message_id, m.sender_ptid, m.content, m.reply_to_ulid, m.thread_root_ulid, m.sent_at
             FROM chat_messages m
             WHERE m.scope = ?1
               AND (?2 = '' OR m.conversation_id = ?2)
               AND m.content LIKE ?3 ESCAPE '\\'
             ORDER BY m.sent_at DESC
             LIMIT ?4",
        )
        .map_err(|e| e.to_string())?;
    let conv = conversation_id
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .unwrap_or("");
    let rows = stmt
        .query_map(params![scope, conv, like_pattern, limit as i64], |row| {
            Ok(LocalChatRecord {
                scope: row.get(0)?,
                conversation_id: row.get(1)?,
                message_id: row.get(2)?,
                sender_ptid: row.get(3)?,
                content: row.get(4)?,
                reply_to_ulid: row.get(5)?,
                thread_root_ulid: row.get(6)?,
                sent_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let record = row.map_err(|e| e.to_string())?;
        if seen.insert(record.message_id.clone()) {
            out.push(record);
        }
    }
    out.sort_by(|a, b| b.sent_at.cmp(&a.sent_at));
    out.truncate(limit);
    Ok(out)
}

fn fts_phrase_query(query: &str) -> Option<String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(format!("\"{}\"", trimmed.replace('"', "\"\"")))
}

fn like_contains_pattern(query: &str) -> String {
    let mut out = String::with_capacity(query.len() + 2);
    out.push('%');
    for ch in query.chars() {
        match ch {
            '\\' | '%' | '_' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out.push('%');
    out
}

/// Local FTS search. `scope`: `Some("friend")`, `Some("group")`, or `None` / empty to search both.
pub fn search_local(
    user_scope: &str,
    scope: Option<&str>,
    conversation_id: Option<&str>,
    query: &str,
    limit: usize,
) -> Result<Vec<LocalChatRecord>, String> {
    let scope_trim = scope.map(str::trim).filter(|s| !s.is_empty());
    match scope_trim {
        Some("friend") | Some("group") => {
            let conn = open_connection(user_scope)?;
            let conn = conn.lock();
            search_local_single(&conn, scope_trim.unwrap(), conversation_id, query, limit)
        }
        None => {
            let conn = open_connection(user_scope)?;
            let conn = conn.lock();
            let friend = search_local_single(&conn, "friend", conversation_id, query, limit)?;
            let group = search_local_single(&conn, "group", conversation_id, query, limit)?;
            Ok(merge_desc_by_sent_at(friend, group, limit))
        }
        Some(other) => Err(format!("unsupported chat search scope: {other}")),
    }
}

/// FTS5 search with optional `scope` (`friend` / `group`) and `conversation_id` filters (empty = no filter).
pub fn search_local_unified(
    user_scope: &str,
    query: &str,
    scope_filter: &str,
    conversation_id: &str,
    limit: usize,
) -> Result<Vec<LocalChatRecord>, String> {
    let scope = match scope_filter.trim() {
        "" => None,
        "friend" => Some("friend"),
        "group" => Some("group"),
        other => return Err(format!("unsupported chat search scope: {other}")),
    };
    let conversation = conversation_id.trim();
    search_local(
        user_scope,
        scope,
        if conversation.is_empty() {
            None
        } else {
            Some(conversation)
        },
        query,
        limit,
    )
}

pub fn set_sync_cursor(user_scope: &str, scope: &str, cursor: &str) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
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
    let conn = conn.lock();
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
    let provider = PlatformKeyProvider::shared();
    get_database_key_version(&spec, provider).map_err(|e| format!("{e:?}"))
}

pub fn rotate_chat_key(user_scope: &str, next_version: i32) -> Result<i32, String> {
    let spec = DatabaseOpenSpec::new_chat_main(user_scope.to_string());
    let provider = PlatformKeyProvider::shared();
    let result = rotate_database_key(&spec, provider, next_version).map_err(|e| format!("{e:?}"));
    // Whether or not the rotation succeeded, drop the cached
    // connection so the next caller re-opens with the (possibly
    // changed) passphrase. Skipping this on success would leave a
    // pooled Connection bound to the old key and every subsequent
    // statement would fail with `file is not a database`.
    invalidate_pool(user_scope);
    result
}

#[cfg(test)]
mod search_tests {
    use super::*;

    fn unique_scope(tag: &str) -> String {
        format!(
            "test-search-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    fn record(message_id: &str, content: &str, sent_at: i64) -> LocalChatRecord {
        LocalChatRecord {
            scope: "group".to_string(),
            conversation_id: "group-1".to_string(),
            message_id: message_id.to_string(),
            sender_ptid: "did:peers:alice".to_string(),
            content: content.to_string(),
            reply_to_ulid: String::new(),
            thread_root_ulid: String::new(),
            sent_at,
        }
    }

    #[test]
    fn search_local_finds_cjk_substrings() {
        let scope = unique_scope("cjk");
        upsert_plaintext_records(
            scope.as_str(),
            &[record("m1", "今天这条消息可以被搜索", 1_700_000_000_000)],
        )
        .expect("index plaintext");

        let results = search_local(scope.as_str(), Some("group"), Some("group-1"), "消息", 10)
            .expect("search local");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].message_id, "m1");
    }

    #[test]
    fn search_local_treats_sql_wildcards_as_text() {
        let scope = unique_scope("wildcard");
        upsert_plaintext_records(
            scope.as_str(),
            &[
                record("m1", "100% ready_about", 1_700_000_000_000),
                record("m2", "plain unrelated", 1_700_000_001_000),
            ],
        )
        .expect("index plaintext");

        let percent_results = search_local(scope.as_str(), Some("group"), Some("group-1"), "%", 10)
            .expect("search percent");
        let underscore_results =
            search_local(scope.as_str(), Some("group"), Some("group-1"), "_", 10)
                .expect("search underscore");

        assert_eq!(percent_results.len(), 1);
        assert_eq!(percent_results[0].message_id, "m1");
        assert_eq!(underscore_results.len(), 1);
        assert_eq!(underscore_results[0].message_id, "m1");
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    #[test]
    fn legacy_direct_storage_is_dropped_idempotently() {
        let connection = Connection::open_in_memory().expect("open migration test database");
        connection
            .execute_batch(
                "CREATE TABLE chat_applied_migrations (
                    name TEXT PRIMARY KEY,
                    applied_at INTEGER NOT NULL
                );
                CREATE TABLE direct_sessions (id TEXT);
                CREATE TABLE direct_skipped_message_keys (id TEXT);
                CREATE TABLE crypto_sessions (id TEXT);
                CREATE TABLE crypto_session_delivery (id TEXT);
                CREATE TABLE crypto_skipped_keys (id TEXT);
                CREATE TABLE crypto_outbox (id TEXT);
                CREATE TABLE crypto_signed_prekey (id TEXT);
                CREATE TABLE crypto_one_time_prekey (id TEXT);",
            )
            .expect("create legacy Direct tables");

        apply_drop_legacy_direct_storage_v1(&connection).expect("drop legacy Direct storage");
        apply_drop_legacy_direct_storage_v1(&connection).expect("repeat Direct storage migration");

        for table in [
            "direct_sessions",
            "direct_skipped_message_keys",
            "crypto_sessions",
            "crypto_session_delivery",
            "crypto_skipped_keys",
            "crypto_outbox",
            "crypto_signed_prekey",
            "crypto_one_time_prekey",
        ] {
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .expect("query migrated table");
            assert_eq!(count, 0, "legacy table still exists: {table}");
        }

        let migration_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM chat_applied_migrations WHERE name = ?1",
                params![DROP_LEGACY_DIRECT_STORAGE_V1],
                |row| row.get(0),
            )
            .expect("query migration marker");
        assert_eq!(migration_count, 1);
    }
}
