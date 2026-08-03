use super::storage::get_database_key_version;
use super::storage::key_provider::PlatformKeyProvider;
use super::storage::open_database;
use super::storage::rotate_database_key;
use crate::domain::crypto::double_ratchet::{DrSessionState, DrSkippedMessageKey};
use crate::domain::crypto::CryptoSessionState;
use crate::domain::storage::database::DatabaseOpenSpec;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatRecord {
    pub scope: String,
    pub conversation_id: String,
    pub message_id: String,
    pub sender_did: String,
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
const ADD_DR_SQL_COLUMNS_V1: &str = "add_double_ratchet_columns_v1";

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
            sender_did TEXT NOT NULL,
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
            sender_did UNINDEXED,
            content
        );
        CREATE TABLE IF NOT EXISTS crypto_sessions (
            session_id TEXT NOT NULL PRIMARY KEY,
            peer_did TEXT NOT NULL,
            send_chain_key BLOB NOT NULL,
            send_counter INTEGER NOT NULL DEFAULT 0,
            recv_chain_key BLOB NOT NULL,
            recv_counter INTEGER NOT NULL DEFAULT 0,
            established INTEGER NOT NULL DEFAULT 0,
            is_initiator INTEGER NOT NULL DEFAULT 1,
            pending_ephemeral BLOB,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS crypto_session_delivery (
            session_id TEXT NOT NULL PRIMARY KEY,
            handshake_delivered INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS crypto_mls_state (
            conversation_id TEXT NOT NULL PRIMARY KEY,
            state_blob BLOB NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS crypto_mls_pending_transition (
            conversation_id TEXT NOT NULL PRIMARY KEY,
            transition_id TEXT NOT NULL,
            state_blob BLOB NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS crypto_mls_identity (
            id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
            ptid TEXT NOT NULL,
            state_blob BLOB NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS crypto_mls_join_provider_pool (
            id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
            state_blob BLOB NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS crypto_mls_recipient_head (
            conversation_id TEXT NOT NULL PRIMARY KEY,
            group_seq INTEGER NOT NULL,
            event_hash BLOB NOT NULL,
            membership_epoch INTEGER NOT NULL,
            mls_epoch INTEGER NOT NULL,
            transition_id TEXT NOT NULL DEFAULT '',
            commit_sha256 BLOB NOT NULL DEFAULT X'',
            status TEXT NOT NULL,
            last_error TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS crypto_mls_recipient_event_buffer (
            conversation_id TEXT NOT NULL,
            group_seq INTEGER NOT NULL,
            event_hash BLOB NOT NULL,
            event_blob BLOB NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(conversation_id, group_seq)
        );
        CREATE TABLE IF NOT EXISTS crypto_mls_recipient_delivery_buffer (
            conversation_id TEXT NOT NULL,
            transition_id TEXT NOT NULL,
            group_seq INTEGER NOT NULL,
            kind INTEGER NOT NULL,
            payload_sha256 BLOB NOT NULL,
            delivery_blob BLOB NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(conversation_id, transition_id),
            UNIQUE(conversation_id, group_seq)
        );
        CREATE TABLE IF NOT EXISTS crypto_mls_recipient_applied (
            conversation_id TEXT NOT NULL,
            transition_id TEXT NOT NULL,
            group_seq INTEGER NOT NULL,
            event_hash BLOB NOT NULL,
            commit_sha256 BLOB NOT NULL,
            payload_sha256 BLOB NOT NULL,
            kind INTEGER NOT NULL,
            applied_at INTEGER NOT NULL,
            PRIMARY KEY(conversation_id, transition_id),
            UNIQUE(conversation_id, group_seq)
        );
        CREATE TABLE IF NOT EXISTS crypto_mls_recipient_applied_event (
            conversation_id TEXT NOT NULL,
            group_seq INTEGER NOT NULL,
            event_hash BLOB NOT NULL,
            applied_at INTEGER NOT NULL,
            PRIMARY KEY(conversation_id, group_seq)
        );
        CREATE TABLE IF NOT EXISTS crypto_mls_local_accepted_transition (
            conversation_id TEXT NOT NULL,
            transition_id TEXT NOT NULL,
            from_mls_epoch INTEGER NOT NULL,
            to_mls_epoch INTEGER NOT NULL,
            commit_sha256 BLOB NOT NULL,
            accepted_at INTEGER NOT NULL,
            PRIMARY KEY(conversation_id, transition_id)
        );
        CREATE TABLE IF NOT EXISTS crypto_signed_prekey (
            id INTEGER NOT NULL PRIMARY KEY,
            private_key BLOB NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS crypto_one_time_prekey (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            private_key BLOB NOT NULL,
            consumed INTEGER NOT NULL DEFAULT 0
        );
        -- Group message payloads are opaque ciphertext. Group encryption state
        -- is owned by the OpenMLS persistence records above.
        CREATE TABLE IF NOT EXISTS group_messages (
            ulid               TEXT    NOT NULL PRIMARY KEY,
            group_ulid         TEXT    NOT NULL DEFAULT '',
            sender_did         TEXT    NOT NULL DEFAULT '',
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
    apply_add_double_ratchet_columns_v1(conn)?;
    Ok(())
}

fn apply_add_double_ratchet_columns_v1(conn: &Connection) -> Result<(), String> {
    let already: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_applied_migrations WHERE name = ?1",
            params![ADD_DR_SQL_COLUMNS_V1],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if already > 0 {
        return Ok(());
    }
    conn.execute_batch(
        "ALTER TABLE crypto_sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE crypto_sessions ADD COLUMN dr_root_key BLOB;
         ALTER TABLE crypto_sessions ADD COLUMN dr_self_priv BLOB;
         ALTER TABLE crypto_sessions ADD COLUMN dr_self_pub BLOB;
         ALTER TABLE crypto_sessions ADD COLUMN dr_peer_pub BLOB;
         ALTER TABLE crypto_sessions ADD COLUMN dr_send_chain_key BLOB;
         ALTER TABLE crypto_sessions ADD COLUMN dr_recv_chain_key BLOB;
         ALTER TABLE crypto_sessions ADD COLUMN dr_ns INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE crypto_sessions ADD COLUMN dr_nr INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE crypto_sessions ADD COLUMN dr_pn INTEGER NOT NULL DEFAULT 0;

         CREATE TABLE IF NOT EXISTS crypto_skipped_keys (
             session_id   TEXT NOT NULL,
             dh_peer_pub  BLOB NOT NULL,
             counter      INTEGER NOT NULL,
             message_key  BLOB NOT NULL,
             created_at   INTEGER NOT NULL,
             PRIMARY KEY (session_id, dh_peer_pub, counter)
         );",
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chat_applied_migrations(name, applied_at) VALUES (?1, ?2)",
        params![ADD_DR_SQL_COLUMNS_V1, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    tracing::info!(
        migration = ADD_DR_SQL_COLUMNS_V1,
        "local_chat_store: applied Double Ratchet SQLCipher columns"
    );
    Ok(())
}

fn upsert_record(conn: &Connection, item: &LocalChatRecord) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chat_messages(scope, conversation_id, message_id, sender_did, content, reply_to_ulid, thread_root_ulid, sent_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(message_id) DO UPDATE SET
           scope=excluded.scope,
           conversation_id=excluded.conversation_id,
           sender_did=excluded.sender_did,
           content=excluded.content,
           reply_to_ulid=excluded.reply_to_ulid,
           thread_root_ulid=excluded.thread_root_ulid,
           sent_at=excluded.sent_at",
        params![
            item.scope,
            item.conversation_id,
            item.message_id,
            item.sender_did,
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
        "INSERT INTO chat_messages_fts(message_id, scope, conversation_id, sender_did, content)
         VALUES(?1, ?2, ?3, ?4, ?5)",
        params![
            item.message_id,
            item.scope,
            item.conversation_id,
            item.sender_did,
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
                sender_did: json_string(m, &["sender_did", "senderDid"]),
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
            sender_did: json_string(&message_value, &["sender_did", "senderDid"]),
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
                sender_did: json_string(m, &["sender_did", "senderDid"]),
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
            sender_did: json_string(&message_value, &["sender_did", "senderDid"]),
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
                "SELECT m.scope, m.conversation_id, m.message_id, m.sender_did, m.content, m.reply_to_ulid, m.thread_root_ulid, m.sent_at
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
                    sender_did: row.get(3)?,
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
            "SELECT m.scope, m.conversation_id, m.message_id, m.sender_did, m.content, m.reply_to_ulid, m.thread_root_ulid, m.sent_at
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
                sender_did: row.get(3)?,
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

pub fn save_crypto_session(user_scope: &str, session: &CryptoSessionState) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let now = chrono_now();
    let pending = session.pending_ephemeral.as_ref().map(|b| b.as_slice());
    let created_at: i64 = conn
        .query_row(
            "SELECT created_at FROM crypto_sessions WHERE session_id = ?1",
            params![session.session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(now);
    conn.execute(
        "INSERT INTO crypto_sessions(
            session_id, peer_did, send_chain_key, send_counter, recv_chain_key, recv_counter,
            established, is_initiator, pending_ephemeral, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(session_id) DO UPDATE SET
            peer_did=excluded.peer_did,
            send_chain_key=excluded.send_chain_key,
            send_counter=excluded.send_counter,
            recv_chain_key=excluded.recv_chain_key,
            recv_counter=excluded.recv_counter,
            established=excluded.established,
            is_initiator=excluded.is_initiator,
            pending_ephemeral=excluded.pending_ephemeral,
            updated_at=excluded.updated_at",
        params![
            session.session_id,
            session.peer_did,
            session.send_chain_key.as_ref(),
            session.send_counter as i64,
            session.recv_chain_key.as_ref(),
            session.recv_counter as i64,
            session.established as i64,
            session.is_initiator as i64,
            pending,
            created_at,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_crypto_session_handshake_delivered(
    user_scope: &str,
    session_id: &str,
    delivered: bool,
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.execute(
        "INSERT INTO crypto_session_delivery(session_id, handshake_delivered, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET
            handshake_delivered=excluded.handshake_delivered,
            updated_at=excluded.updated_at",
        params![session_id, delivered as i64, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn crypto_session_handshake_delivered(
    user_scope: &str,
    session_id: &str,
) -> Result<bool, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT handshake_delivered FROM crypto_session_delivery WHERE session_id = ?1",
        params![session_id],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|value| value.unwrap_or(0) != 0)
    .map_err(|e| e.to_string())
}

pub fn crypto_save_mls_state(
    user_scope: &str,
    conversation_id: &str,
    state_blob: &[u8],
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.execute(
        "INSERT INTO crypto_mls_state(conversation_id, state_blob, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(conversation_id) DO UPDATE SET
            state_blob=excluded.state_blob,
            updated_at=excluded.updated_at",
        params![conversation_id, state_blob, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn crypto_load_mls_state(
    user_scope: &str,
    conversation_id: &str,
) -> Result<Option<Vec<u8>>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT state_blob FROM crypto_mls_state WHERE conversation_id = ?1",
        params![conversation_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn crypto_save_actor_device_identity(
    user_scope: &str,
    ptid: &str,
    state_blob: &[u8],
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.execute(
        "INSERT INTO crypto_mls_identity(id, ptid, state_blob, updated_at)
         VALUES (1, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET
            ptid=excluded.ptid,
            state_blob=excluded.state_blob,
            updated_at=excluded.updated_at",
        params![ptid, state_blob, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn crypto_load_actor_device_identity(
    user_scope: &str,
) -> Result<Option<(String, Vec<u8>)>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT ptid, state_blob FROM crypto_mls_identity WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn crypto_save_mls_join_provider_pool(
    user_scope: &str,
    state_blob: &[u8],
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.execute(
        "INSERT INTO crypto_mls_join_provider_pool(id, state_blob, updated_at)
         VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET
            state_blob=excluded.state_blob,
            updated_at=excluded.updated_at",
        params![state_blob, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn crypto_load_mls_join_provider_pool(user_scope: &str) -> Result<Option<Vec<u8>>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT state_blob FROM crypto_mls_join_provider_pool WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CryptoMlsRecipientHead {
    pub conversation_id: String,
    pub group_seq: i64,
    pub event_hash: Vec<u8>,
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub transition_id: String,
    pub commit_sha256: Vec<u8>,
    pub status: String,
    pub last_error: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CryptoMlsBufferedEvent {
    pub group_seq: i64,
    pub event_hash: Vec<u8>,
    pub event_blob: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CryptoMlsBufferedDelivery {
    pub transition_id: String,
    pub group_seq: i64,
    pub kind: i32,
    pub payload_sha256: Vec<u8>,
    pub delivery_blob: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CryptoMlsAppliedTransition {
    pub group_seq: i64,
    pub event_hash: Vec<u8>,
    pub commit_sha256: Vec<u8>,
    pub payload_sha256: Vec<u8>,
    pub kind: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CryptoMlsLocalAcceptedTransition {
    pub from_mls_epoch: i64,
    pub to_mls_epoch: i64,
    pub commit_sha256: Vec<u8>,
}

pub fn crypto_load_mls_recipient_head(
    user_scope: &str,
    conversation_id: &str,
) -> Result<Option<CryptoMlsRecipientHead>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT conversation_id, group_seq, event_hash, membership_epoch, mls_epoch,
                transition_id, commit_sha256, status, last_error
         FROM crypto_mls_recipient_head
         WHERE conversation_id = ?1",
        params![conversation_id],
        |row| {
            Ok(CryptoMlsRecipientHead {
                conversation_id: row.get(0)?,
                group_seq: row.get(1)?,
                event_hash: row.get(2)?,
                membership_epoch: row.get(3)?,
                mls_epoch: row.get(4)?,
                transition_id: row.get(5)?,
                commit_sha256: row.get(6)?,
                status: row.get(7)?,
                last_error: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn crypto_enqueue_mls_recipient_event(
    user_scope: &str,
    conversation_id: &str,
    group_seq: i64,
    event_hash: &[u8],
    event_blob: &[u8],
    limit: usize,
) -> Result<bool, String> {
    let conn = open_connection(user_scope)?;
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let existing = tx
        .query_row(
            "SELECT event_hash FROM crypto_mls_recipient_event_buffer
             WHERE conversation_id = ?1 AND group_seq = ?2",
            params![conversation_id, group_seq],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(existing_hash) = existing {
        if existing_hash == event_hash {
            return Ok(false);
        }
        return Err("recipient event buffer has a same-sequence hash conflict".to_string());
    }
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM crypto_mls_recipient_event_buffer
             WHERE conversation_id = ?1",
            params![conversation_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count >= limit as i64 {
        return Err("recipient event reorder buffer overflow".to_string());
    }
    tx.execute(
        "INSERT INTO crypto_mls_recipient_event_buffer(
            conversation_id, group_seq, event_hash, event_blob, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            conversation_id,
            group_seq,
            event_hash,
            event_blob,
            chrono_now()
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn crypto_enqueue_mls_recipient_delivery(
    user_scope: &str,
    delivery: &CryptoMlsBufferedDelivery,
    conversation_id: &str,
    limit: usize,
) -> Result<bool, String> {
    let conn = open_connection(user_scope)?;
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let existing = tx
        .query_row(
            "SELECT group_seq, kind, payload_sha256
             FROM crypto_mls_recipient_delivery_buffer
             WHERE conversation_id = ?1 AND transition_id = ?2",
            params![conversation_id, delivery.transition_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((group_seq, kind, payload_sha256)) = existing {
        if group_seq == delivery.group_seq
            && kind == delivery.kind
            && payload_sha256 == delivery.payload_sha256
        {
            return Ok(false);
        }
        return Err("recipient delivery buffer has a transition conflict".to_string());
    }
    let sequence_owner = tx
        .query_row(
            "SELECT transition_id FROM crypto_mls_recipient_delivery_buffer
             WHERE conversation_id = ?1 AND group_seq = ?2",
            params![conversation_id, delivery.group_seq],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if sequence_owner.is_some() {
        return Err("recipient delivery buffer has a same-sequence conflict".to_string());
    }
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM crypto_mls_recipient_delivery_buffer
             WHERE conversation_id = ?1",
            params![conversation_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count >= limit as i64 {
        return Err("recipient delivery reorder buffer overflow".to_string());
    }
    tx.execute(
        "INSERT INTO crypto_mls_recipient_delivery_buffer(
            conversation_id, transition_id, group_seq, kind,
            payload_sha256, delivery_blob, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            conversation_id,
            delivery.transition_id,
            delivery.group_seq,
            delivery.kind,
            delivery.payload_sha256,
            delivery.delivery_blob,
            chrono_now()
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn crypto_load_next_mls_recipient_event(
    user_scope: &str,
    conversation_id: &str,
) -> Result<Option<CryptoMlsBufferedEvent>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT group_seq, event_hash, event_blob
         FROM crypto_mls_recipient_event_buffer
         WHERE conversation_id = ?1
         ORDER BY group_seq ASC
         LIMIT 1",
        params![conversation_id],
        |row| {
            Ok(CryptoMlsBufferedEvent {
                group_seq: row.get(0)?,
                event_hash: row.get(1)?,
                event_blob: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn crypto_load_mls_recipient_delivery(
    user_scope: &str,
    conversation_id: &str,
    transition_id: &str,
) -> Result<Option<CryptoMlsBufferedDelivery>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT transition_id, group_seq, kind, payload_sha256, delivery_blob
         FROM crypto_mls_recipient_delivery_buffer
         WHERE conversation_id = ?1 AND transition_id = ?2",
        params![conversation_id, transition_id],
        |row| {
            Ok(CryptoMlsBufferedDelivery {
                transition_id: row.get(0)?,
                group_seq: row.get(1)?,
                kind: row.get(2)?,
                payload_sha256: row.get(3)?,
                delivery_blob: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn crypto_count_mls_recipient_buffers(
    user_scope: &str,
    conversation_id: &str,
) -> Result<(i64, i64), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let events = conn
        .query_row(
            "SELECT COUNT(*) FROM crypto_mls_recipient_event_buffer
             WHERE conversation_id = ?1",
            params![conversation_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let deliveries = conn
        .query_row(
            "SELECT COUNT(*) FROM crypto_mls_recipient_delivery_buffer
             WHERE conversation_id = ?1",
            params![conversation_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok((events, deliveries))
}

pub fn crypto_load_mls_applied_transition(
    user_scope: &str,
    conversation_id: &str,
    transition_id: &str,
) -> Result<Option<CryptoMlsAppliedTransition>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT group_seq, event_hash, commit_sha256, payload_sha256, kind
         FROM crypto_mls_recipient_applied
         WHERE conversation_id = ?1 AND transition_id = ?2",
        params![conversation_id, transition_id],
        |row| {
            Ok(CryptoMlsAppliedTransition {
                group_seq: row.get(0)?,
                event_hash: row.get(1)?,
                commit_sha256: row.get(2)?,
                payload_sha256: row.get(3)?,
                kind: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn crypto_load_mls_local_accepted_transition(
    user_scope: &str,
    conversation_id: &str,
    transition_id: &str,
) -> Result<Option<CryptoMlsLocalAcceptedTransition>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT from_mls_epoch, to_mls_epoch, commit_sha256
         FROM crypto_mls_local_accepted_transition
         WHERE conversation_id = ?1 AND transition_id = ?2",
        params![conversation_id, transition_id],
        |row| {
            Ok(CryptoMlsLocalAcceptedTransition {
                from_mls_epoch: row.get(0)?,
                to_mls_epoch: row.get(1)?,
                commit_sha256: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn crypto_load_mls_applied_event_hash(
    user_scope: &str,
    conversation_id: &str,
    group_seq: i64,
) -> Result<Option<Vec<u8>>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT event_hash FROM crypto_mls_recipient_applied_event
         WHERE conversation_id = ?1 AND group_seq = ?2",
        params![conversation_id, group_seq],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn crypto_delete_mls_recipient_event(
    user_scope: &str,
    conversation_id: &str,
    group_seq: i64,
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.execute(
        "DELETE FROM crypto_mls_recipient_event_buffer
         WHERE conversation_id = ?1 AND group_seq = ?2",
        params![conversation_id, group_seq],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn crypto_commit_plain_recipient_event(
    user_scope: &str,
    conversation_id: &str,
    group_seq: i64,
    event_hash: &[u8],
    membership_epoch: i64,
    mls_epoch: i64,
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO crypto_mls_recipient_applied_event(
            conversation_id, group_seq, event_hash, applied_at
         ) VALUES (?1, ?2, ?3, ?4)",
        params![conversation_id, group_seq, event_hash, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    upsert_mls_recipient_head(
        &tx,
        conversation_id,
        group_seq,
        event_hash,
        membership_epoch,
        mls_epoch,
        "",
        &[],
        "active",
        "",
    )?;
    tx.execute(
        "DELETE FROM crypto_mls_recipient_event_buffer
         WHERE conversation_id = ?1 AND group_seq = ?2",
        params![conversation_id, group_seq],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[allow(clippy::too_many_arguments)]
pub fn crypto_commit_mls_recipient_transition(
    user_scope: &str,
    conversation_id: &str,
    group_seq: i64,
    event_hash: &[u8],
    membership_epoch: i64,
    mls_epoch: i64,
    transition_id: &str,
    commit_sha256: &[u8],
    payload_sha256: &[u8],
    kind: i32,
    accepted_state_blob: &[u8],
    provider_pool_blob: Option<&[u8]>,
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO crypto_mls_state(conversation_id, state_blob, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(conversation_id) DO UPDATE SET
            state_blob=excluded.state_blob,
            updated_at=excluded.updated_at",
        params![conversation_id, accepted_state_blob, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    if let Some(provider_pool_blob) = provider_pool_blob {
        tx.execute(
            "INSERT INTO crypto_mls_join_provider_pool(id, state_blob, updated_at)
             VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET
                state_blob=excluded.state_blob,
                updated_at=excluded.updated_at",
            params![provider_pool_blob, chrono_now()],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT INTO crypto_mls_recipient_applied(
            conversation_id, transition_id, group_seq, event_hash,
            commit_sha256, payload_sha256, kind, applied_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            conversation_id,
            transition_id,
            group_seq,
            event_hash,
            commit_sha256,
            payload_sha256,
            kind,
            chrono_now()
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO crypto_mls_recipient_applied_event(
            conversation_id, group_seq, event_hash, applied_at
         ) VALUES (?1, ?2, ?3, ?4)",
        params![conversation_id, group_seq, event_hash, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    upsert_mls_recipient_head(
        &tx,
        conversation_id,
        group_seq,
        event_hash,
        membership_epoch,
        mls_epoch,
        transition_id,
        commit_sha256,
        "active",
        "",
    )?;
    tx.execute(
        "DELETE FROM crypto_mls_recipient_event_buffer
         WHERE conversation_id = ?1 AND group_seq = ?2",
        params![conversation_id, group_seq],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM crypto_mls_recipient_delivery_buffer
         WHERE conversation_id = ?1 AND transition_id = ?2",
        params![conversation_id, transition_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM crypto_mls_local_accepted_transition
         WHERE conversation_id = ?1 AND transition_id = ?2",
        params![conversation_id, transition_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn crypto_mark_mls_recipient_status(
    user_scope: &str,
    conversation_id: &str,
    status: &str,
    last_error: &str,
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.execute(
        "INSERT INTO crypto_mls_recipient_head(
            conversation_id, group_seq, event_hash, membership_epoch, mls_epoch,
            transition_id, commit_sha256, status, last_error, updated_at
         ) VALUES (?1, 0, X'', 0, 0, '', X'', ?2, ?3, ?4)
         ON CONFLICT(conversation_id) DO UPDATE SET
            status=excluded.status,
            last_error=excluded.last_error,
            updated_at=excluded.updated_at",
        params![conversation_id, status, last_error, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn upsert_mls_recipient_head(
    tx: &rusqlite::Transaction<'_>,
    conversation_id: &str,
    group_seq: i64,
    event_hash: &[u8],
    membership_epoch: i64,
    mls_epoch: i64,
    transition_id: &str,
    commit_sha256: &[u8],
    status: &str,
    last_error: &str,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO crypto_mls_recipient_head(
            conversation_id, group_seq, event_hash, membership_epoch, mls_epoch,
            transition_id, commit_sha256, status, last_error, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(conversation_id) DO UPDATE SET
            group_seq=excluded.group_seq,
            event_hash=excluded.event_hash,
            membership_epoch=excluded.membership_epoch,
            mls_epoch=excluded.mls_epoch,
            transition_id=CASE
                WHEN excluded.transition_id = '' THEN crypto_mls_recipient_head.transition_id
                ELSE excluded.transition_id
            END,
            commit_sha256=CASE
                WHEN length(excluded.commit_sha256) = 0 THEN crypto_mls_recipient_head.commit_sha256
                ELSE excluded.commit_sha256
            END,
            status=excluded.status,
            last_error=excluded.last_error,
            updated_at=excluded.updated_at",
        params![
            conversation_id,
            group_seq,
            event_hash,
            membership_epoch,
            mls_epoch,
            transition_id,
            commit_sha256,
            status,
            last_error,
            chrono_now()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn crypto_save_mls_join_result(
    user_scope: &str,
    conversation_id: &str,
    accepted_state_blob: &[u8],
    provider_pool_blob: &[u8],
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO crypto_mls_state(conversation_id, state_blob, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(conversation_id) DO UPDATE SET
            state_blob=excluded.state_blob,
            updated_at=excluded.updated_at",
        params![conversation_id, accepted_state_blob, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO crypto_mls_join_provider_pool(id, state_blob, updated_at)
         VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET
            state_blob=excluded.state_blob,
            updated_at=excluded.updated_at",
        params![provider_pool_blob, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn crypto_save_mls_pending_transition(
    user_scope: &str,
    conversation_id: &str,
    transition_id: &str,
    state_blob: &[u8],
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.execute(
        "INSERT INTO crypto_mls_pending_transition(
            conversation_id, transition_id, state_blob, updated_at
         ) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(conversation_id) DO UPDATE SET
            transition_id=excluded.transition_id,
            state_blob=excluded.state_blob,
            updated_at=excluded.updated_at",
        params![conversation_id, transition_id, state_blob, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn crypto_load_mls_pending_transition(
    user_scope: &str,
    conversation_id: &str,
) -> Result<Option<(String, Vec<u8>)>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.query_row(
        "SELECT transition_id, state_blob
         FROM crypto_mls_pending_transition
         WHERE conversation_id = ?1",
        params![conversation_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn crypto_delete_mls_pending_transition(
    user_scope: &str,
    conversation_id: &str,
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    conn.execute(
        "DELETE FROM crypto_mls_pending_transition WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn crypto_accept_mls_transition(
    user_scope: &str,
    conversation_id: &str,
    transition_id: &str,
    from_mls_epoch: i64,
    to_mls_epoch: i64,
    commit_sha256: &[u8],
    accepted_state_blob: &[u8],
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO crypto_mls_state(conversation_id, state_blob, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(conversation_id) DO UPDATE SET
            state_blob=excluded.state_blob,
            updated_at=excluded.updated_at",
        params![conversation_id, accepted_state_blob, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO crypto_mls_local_accepted_transition(
            conversation_id, transition_id, from_mls_epoch, to_mls_epoch,
            commit_sha256, accepted_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(conversation_id, transition_id) DO UPDATE SET
            from_mls_epoch=excluded.from_mls_epoch,
            to_mls_epoch=excluded.to_mls_epoch,
            commit_sha256=excluded.commit_sha256,
            accepted_at=excluded.accepted_at",
        params![
            conversation_id,
            transition_id,
            from_mls_epoch,
            to_mls_epoch,
            commit_sha256,
            chrono_now()
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM crypto_mls_pending_transition WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn load_crypto_session(
    user_scope: &str,
    session_id: &str,
) -> Result<Option<CryptoSessionState>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let mut stmt = conn
        .prepare(
            "SELECT peer_did, send_chain_key, send_counter, recv_chain_key, recv_counter,
                    established, is_initiator, pending_ephemeral
             FROM crypto_sessions WHERE session_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let row = stmt
        .query_row(params![session_id], |row| {
            let send_blob: Vec<u8> = row.get(1)?;
            let recv_blob: Vec<u8> = row.get(3)?;
            let pending: Option<Vec<u8>> = row.get(7)?;
            Ok((
                row.get::<_, String>(0)?,
                send_blob,
                row.get::<_, i64>(2)? as u32,
                recv_blob,
                row.get::<_, i64>(4)? as u32,
                row.get::<_, i64>(5)? != 0,
                row.get::<_, i64>(6)? != 0,
                pending,
            ))
        })
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((
        peer_did,
        send_blob,
        send_counter,
        recv_blob,
        recv_counter,
        established,
        is_initiator,
        pending,
    )) = row
    else {
        return Ok(None);
    };
    if send_blob.len() != 32 || recv_blob.len() != 32 {
        return Err("invalid chain key length in crypto_sessions".to_string());
    }
    let mut send_chain_key = [0u8; 32];
    send_chain_key.copy_from_slice(&send_blob[..32]);
    let mut recv_chain_key = [0u8; 32];
    recv_chain_key.copy_from_slice(&recv_blob[..32]);
    let pending_ephemeral = pending.and_then(|p| {
        if p.len() == 32 {
            let mut a = [0u8; 32];
            a.copy_from_slice(&p);
            Some(a)
        } else {
            None
        }
    });
    Ok(Some(CryptoSessionState {
        session_id: session_id.to_string(),
        peer_did,
        send_chain_key,
        send_counter,
        recv_chain_key,
        recv_counter,
        established,
        is_initiator,
        pending_ephemeral,
    }))
}

// ---------------------------------------------------------------------------
// Double Ratchet persistence (`version = 1` rows only)
// ---------------------------------------------------------------------------

fn save_dr_session_with_conn(conn: &Connection, state: &DrSessionState) -> Result<(), String> {
    let now = chrono_now();
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM crypto_sessions WHERE session_id = ?1",
            params![state.session_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err(
            "save_dr_session: missing crypto_sessions row; persist X3DH bootstrap state first"
                .to_string(),
        );
    }
    let dr_peer = state.peer_pub.as_ref().map(|p| p.as_slice());
    let dr_sck = state.send_chain_key.as_ref().map(|p| p.as_slice());
    let dr_rck = state.recv_chain_key.as_ref().map(|p| p.as_slice());
    conn.execute(
        "UPDATE crypto_sessions SET
            version = 1,
            dr_root_key = ?1,
            dr_self_priv = ?2,
            dr_self_pub = ?3,
            dr_peer_pub = ?4,
            dr_send_chain_key = ?5,
            dr_recv_chain_key = ?6,
            dr_ns = ?7,
            dr_nr = ?8,
            dr_pn = ?9,
            updated_at = ?10
         WHERE session_id = ?11",
        params![
            state.root_key.as_slice(),
            state.self_priv.as_slice(),
            state.self_pub.as_slice(),
            dr_peer,
            dr_sck,
            dr_rck,
            state.n_send as i64,
            state.n_recv as i64,
            state.n_prev as i64,
            now,
            state.session_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Upsert DR material for an existing `crypto_sessions` row (`version` → 1).
pub fn save_dr_session(user_scope: &str, state: &DrSessionState) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    save_dr_session_with_conn(&conn, state)
}

/// Load DR session state for `version = 1` rows only.
pub fn load_dr_session(
    user_scope: &str,
    session_id: &str,
) -> Result<Option<DrSessionState>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let mut stmt = conn
        .prepare(
            "SELECT dr_root_key, dr_self_priv, dr_self_pub, dr_peer_pub, dr_send_chain_key,
                    dr_recv_chain_key, dr_ns, dr_nr, dr_pn
             FROM crypto_sessions WHERE session_id = ?1 AND version = 1",
        )
        .map_err(|e| e.to_string())?;
    let row = stmt
        .query_row(params![session_id], |r| {
            Ok((
                r.get::<_, Option<Vec<u8>>>(0)?,
                r.get::<_, Option<Vec<u8>>>(1)?,
                r.get::<_, Option<Vec<u8>>>(2)?,
                r.get::<_, Option<Vec<u8>>>(3)?,
                r.get::<_, Option<Vec<u8>>>(4)?,
                r.get::<_, Option<Vec<u8>>>(5)?,
                r.get::<_, i64>(6)? as u32,
                r.get::<_, i64>(7)? as u32,
                r.get::<_, i64>(8)? as u32,
            ))
        })
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((rk_b, sp_b, s_pub_b, pp_b, sck_b, rck_b, ns, nr, pn)) = row else {
        return Ok(None);
    };
    let Some(rk_b) = rk_b else {
        return Ok(None);
    };
    let Some(sp_b) = sp_b else {
        return Ok(None);
    };
    let Some(s_pub_b) = s_pub_b else {
        return Ok(None);
    };
    if rk_b.len() != 32 || sp_b.len() != 32 || s_pub_b.len() != 32 {
        return Err("invalid DR key material length in crypto_sessions".to_string());
    }
    let peer_pub = match pp_b {
        None => None,
        Some(b) if b.is_empty() => None,
        Some(b) if b.len() == 32 => {
            let mut p = [0u8; 32];
            p.copy_from_slice(&b);
            Some(p)
        }
        Some(_) => return Err("invalid dr_peer_pub length in crypto_sessions".to_string()),
    };
    let mut root_key = [0u8; 32];
    root_key.copy_from_slice(&rk_b);
    let mut self_priv = [0u8; 32];
    self_priv.copy_from_slice(&sp_b);
    let mut self_pub = [0u8; 32];
    self_pub.copy_from_slice(&s_pub_b);
    let send_chain_key = match sck_b {
        None => None,
        Some(b) if b.len() == 32 => {
            let mut c = [0u8; 32];
            c.copy_from_slice(&b);
            Some(c)
        }
        Some(_) => return Err("invalid dr_send_chain_key length".to_string()),
    };
    let recv_chain_key = match rck_b {
        None => None,
        Some(b) if b.len() == 32 => {
            let mut c = [0u8; 32];
            c.copy_from_slice(&b);
            Some(c)
        }
        Some(_) => return Err("invalid dr_recv_chain_key length".to_string()),
    };
    Ok(Some(DrSessionState {
        session_id: session_id.to_string(),
        root_key,
        self_priv,
        self_pub,
        peer_pub,
        send_chain_key,
        recv_chain_key,
        n_send: ns,
        n_recv: nr,
        n_prev: pn,
    }))
}

pub fn load_dr_skipped_keys(
    user_scope: &str,
    session_id: &str,
) -> Result<Vec<DrSkippedMessageKey>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let mut stmt = conn
        .prepare("SELECT dh_peer_pub, counter, message_key FROM crypto_skipped_keys WHERE session_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![session_id], |r| {
            let dh: Vec<u8> = r.get(0)?;
            let ctr: i64 = r.get(1)?;
            let mk: Vec<u8> = r.get(2)?;
            Ok((dh, ctr as u32, mk))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (dh, ctr, mk) = row.map_err(|e| e.to_string())?;
        if dh.len() != 32 || mk.len() != 32 {
            return Err("invalid skipped-key column lengths (DR)".to_string());
        }
        let mut peer_pub = [0u8; 32];
        peer_pub.copy_from_slice(&dh);
        let mut message_key = [0u8; 32];
        message_key.copy_from_slice(&mk);
        out.push(DrSkippedMessageKey {
            session_id: session_id.to_string(),
            peer_pub,
            counter: ctr,
            message_key,
        });
    }
    Ok(out)
}

/// Atomic write for the DR receive path — session advance + skipped-key rows.
pub fn apply_dr_decrypt_outcome(
    user_scope: &str,
    advanced: &DrSessionState,
    new_skipped: &[DrSkippedMessageKey],
    consumed: Option<([u8; 32], u32)>,
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    save_dr_session_with_conn(&tx, advanced)?;
    let now = chrono_now();
    for s in new_skipped {
        tx.execute(
            "INSERT OR IGNORE INTO crypto_skipped_keys(
                session_id, dh_peer_pub, counter, message_key, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                s.session_id,
                s.peer_pub.as_slice(),
                s.counter as i64,
                s.message_key.as_slice(),
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some((dh, ctr)) = consumed {
        tx.execute(
            "DELETE FROM crypto_skipped_keys WHERE session_id = ?1 AND dh_peer_pub = ?2 AND counter = ?3",
            params![advanced.session_id, dh.as_slice(), ctr as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Store signed pre-key material for later X3DH receive paths.
pub fn crypto_store_signed_prekey(
    user_scope: &str,
    id: i64,
    private_key: &[u8],
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let now = chrono_now();
    conn.execute(
        "INSERT INTO crypto_signed_prekey(id, private_key, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET private_key=excluded.private_key, created_at=excluded.created_at",
        params![id, private_key, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Insert one-time pre-keys; returns generated row ids.
pub fn crypto_insert_opks(user_scope: &str, private_keys: &[Vec<u8>]) -> Result<Vec<i64>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let mut ids = Vec::with_capacity(private_keys.len());
    for pk in private_keys {
        conn.execute(
            "INSERT INTO crypto_one_time_prekey(private_key, consumed) VALUES (?1, 0)",
            params![pk.as_slice()],
        )
        .map_err(|e| e.to_string())?;
        let id: i64 = conn.last_insert_rowid();
        ids.push(id);
    }
    Ok(ids)
}

pub fn crypto_load_signed_prekey_by_public(
    user_scope: &str,
    public_key: &[u8; 32],
) -> Result<[u8; 32], String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let mut stmt = conn
        .prepare("SELECT private_key FROM crypto_signed_prekey ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, Vec<u8>>(0))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let private = row.map_err(|e| e.to_string())?;
        if private.len() != 32 {
            continue;
        }
        let mut private_key = [0u8; 32];
        private_key.copy_from_slice(&private);
        let derived = x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(private_key));
        if derived.to_bytes() == *public_key {
            return Ok(private_key);
        }
    }
    Err("signed pre-key is unavailable or has rotated".to_string())
}

pub fn crypto_consume_opk_by_public(
    user_scope: &str,
    public_key: &[u8; 32],
) -> Result<[u8; 32], String> {
    let conn = open_connection(user_scope)?;
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let matched = {
        let mut stmt = tx
            .prepare(
                "SELECT id, private_key FROM crypto_one_time_prekey
                 WHERE consumed = 0 ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut matched = None;
        for row in rows {
            let (id, private) = row.map_err(|e| e.to_string())?;
            if private.len() != 32 {
                continue;
            }
            let mut private_key = [0u8; 32];
            private_key.copy_from_slice(&private);
            let derived =
                x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(private_key));
            if derived.to_bytes() == *public_key {
                matched = Some((id, private_key));
                break;
            }
        }
        matched
    };
    let Some((id, private_key)) = matched else {
        return Err("one-time pre-key is unavailable or already consumed".to_string());
    };
    tx.execute(
        "UPDATE crypto_one_time_prekey SET consumed = 1 WHERE id = ?1 AND consumed = 0",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(private_key)
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
            sender_did: "did:peers:alice".to_string(),
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
mod dr_persistence_tests {
    use super::*;
    use crate::domain::crypto::double_ratchet::{decrypt, encrypt, init_initiator, init_responder};
    use rand::rngs::OsRng;
    use rand::RngCore;
    use x25519_dalek::{PublicKey, StaticSecret};

    fn unique_scope(tag: &str) -> String {
        format!(
            "test-dr-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    fn placeholder_chain() -> [u8; 32] {
        [0xAB; 32]
    }

    #[test]
    fn mls_acceptance_atomically_replaces_pending_state() {
        let scope = unique_scope("mls-accept");
        let conversation_id = "conversation-mls-accept";
        crypto_save_actor_device_identity(&scope, "did:alice", b"identity-state").unwrap();
        assert_eq!(
            crypto_load_actor_device_identity(&scope).unwrap(),
            Some(("did:alice".to_string(), b"identity-state".to_vec()))
        );
        crypto_save_mls_join_provider_pool(&scope, b"provider-pool").unwrap();
        assert_eq!(
            crypto_load_mls_join_provider_pool(&scope).unwrap(),
            Some(b"provider-pool".to_vec())
        );
        crypto_save_mls_pending_transition(
            &scope,
            conversation_id,
            "transition-1",
            b"pending-state",
        )
        .unwrap();

        crypto_accept_mls_transition(
            &scope,
            conversation_id,
            "transition-1",
            0,
            1,
            &[7; 32],
            b"accepted-state",
        )
        .unwrap();

        assert_eq!(
            crypto_load_mls_state(&scope, conversation_id).unwrap(),
            Some(b"accepted-state".to_vec())
        );
        assert!(crypto_load_mls_pending_transition(&scope, conversation_id)
            .unwrap()
            .is_none());
        assert_eq!(
            crypto_load_mls_local_accepted_transition(&scope, conversation_id, "transition-1")
                .unwrap()
                .unwrap()
                .commit_sha256,
            vec![7; 32]
        );
    }

    #[test]
    fn mls_recipient_event_buffer_is_bounded_and_fork_protected() {
        let scope = unique_scope("mls-recipient-buffer");
        let conversation_id = "conversation-buffer";
        for seq in 1..=128i64 {
            let hash = vec![seq as u8; 32];
            assert!(crypto_enqueue_mls_recipient_event(
                &scope,
                conversation_id,
                seq,
                &hash,
                &[seq as u8],
                128,
            )
            .unwrap());
        }
        assert!(!crypto_enqueue_mls_recipient_event(
            &scope,
            conversation_id,
            1,
            &[1; 32],
            &[1],
            128,
        )
        .unwrap());
        assert!(crypto_enqueue_mls_recipient_event(
            &scope,
            conversation_id,
            1,
            &[9; 32],
            &[9],
            128,
        )
        .is_err());
        assert!(crypto_enqueue_mls_recipient_event(
            &scope,
            conversation_id,
            129,
            &[129; 32],
            &[129],
            128,
        )
        .is_err());
    }

    #[test]
    fn dr_round_trip_with_persistence() {
        let scope_i = unique_scope("init");
        let scope_r = unique_scope("resp");
        let sid = format!(
            "dr-sess-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        let base_i = CryptoSessionState {
            session_id: sid.clone(),
            peer_did: "did:peers:bob".to_string(),
            send_chain_key: placeholder_chain(),
            send_counter: 0,
            recv_chain_key: placeholder_chain(),
            recv_counter: 0,
            established: true,
            is_initiator: true,
            pending_ephemeral: None,
        };
        save_crypto_session(&scope_i, &base_i).unwrap();

        let mut shared = [0u8; 32];
        OsRng.fill_bytes(&mut shared);
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();

        let mut alice = init_initiator(&sid, &shared, bob_pub);
        save_dr_session(&scope_i, &alice).unwrap();
        let legacy_after_dr = load_crypto_session(&scope_i, &sid).unwrap().unwrap();
        assert_eq!(legacy_after_dr.send_chain_key, placeholder_chain());
        assert_eq!(legacy_after_dr.recv_chain_key, placeholder_chain());
        assert!(!crypto_session_handshake_delivered(&scope_i, &sid).unwrap());
        set_crypto_session_handshake_delivered(&scope_i, &sid, true).unwrap();
        assert!(crypto_session_handshake_delivered(&scope_i, &sid).unwrap());

        let wire = encrypt(&mut alice, b"hello-dr-sql", b"aad").unwrap();
        save_dr_session(&scope_i, &alice).unwrap();

        let base_r = CryptoSessionState {
            session_id: sid.clone(),
            peer_did: "did:peers:alice".to_string(),
            send_chain_key: placeholder_chain(),
            send_counter: 0,
            recv_chain_key: placeholder_chain(),
            recv_counter: 0,
            established: true,
            is_initiator: false,
            pending_ephemeral: None,
        };
        save_crypto_session(&scope_r, &base_r).unwrap();

        let bob = init_responder(&sid, &shared, bob_priv.to_bytes());
        save_dr_session(&scope_r, &bob).unwrap();

        let loaded_bob = load_dr_session(&scope_r, &sid)
            .unwrap()
            .expect("bob dr state");
        let pre = load_dr_skipped_keys(&scope_r, &sid).unwrap();
        let out = decrypt(&loaded_bob, &wire, &pre, b"aad").unwrap();
        apply_dr_decrypt_outcome(
            &scope_r,
            &out.advanced_state,
            &out.new_skipped,
            out.consumed_skipped,
        )
        .unwrap();

        assert_eq!(out.plaintext, b"hello-dr-sql");

        let bob_reloaded = load_dr_session(&scope_r, &sid).unwrap().unwrap();
        assert_eq!(bob_reloaded.n_recv, out.advanced_state.n_recv);
    }

    #[test]
    fn recipient_prekeys_are_resolved_by_public_key_and_opk_is_single_use() {
        let scope = unique_scope("prekeys");
        let signed_private = StaticSecret::random_from_rng(&mut OsRng);
        let signed_public = PublicKey::from(&signed_private).to_bytes();
        crypto_store_signed_prekey(&scope, 1, signed_private.to_bytes().as_slice()).unwrap();
        assert_eq!(
            crypto_load_signed_prekey_by_public(&scope, &signed_public).unwrap(),
            signed_private.to_bytes(),
        );

        let opk_private = StaticSecret::random_from_rng(&mut OsRng);
        let opk_public = PublicKey::from(&opk_private).to_bytes();
        crypto_insert_opks(&scope, &[opk_private.to_bytes().to_vec()]).unwrap();
        assert_eq!(
            crypto_consume_opk_by_public(&scope, &opk_public).unwrap(),
            opk_private.to_bytes(),
        );
        assert!(crypto_consume_opk_by_public(&scope, &opk_public).is_err());
    }
}
