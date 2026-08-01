use super::storage::get_database_key_version;
use super::storage::key_provider::PlatformKeyProvider;
use super::storage::open_database;
use super::storage::rotate_database_key;
use crate::domain::crypto::double_ratchet::{DrSessionState, DrSkippedMessageKey};
use crate::domain::crypto::sender_keys::{SenderChainState, SkippedMessageKey};
use crate::domain::crypto::CryptoSessionState;
use crate::domain::storage::database::DatabaseOpenSpec;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
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
const LEGACY_GROUP_PLAINTEXT_WIPE_MIGRATION: &str = "legacy_group_plaintext_wipe_v1";
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
        -- The crypto_group_keys table is intentionally NOT created. The
        -- previous design (one shared symmetric key per group, generated
        -- per-device with no distribution) was removed alongside the
        -- crypto_group_encrypt/decrypt/rotate Tauri commands -- see
        -- peers-touch/docs/architecture/encryption/group-sender-keys.md
        -- for the replacement design. Existing tables on already-migrated
        -- devices are left in place for a future migration to drop them
        -- explicitly; they are inert because no code path reads or writes
        -- them anymore.
        --
        -- Sender Keys persistence (G3 of the rollout). Two tables:
        --   * group_sender_keys:        one row per (group, sender,
        --                               sender_key_id) chain. Holds the
        --                               current chain key + counter, the
        --                               sender's signing seed (NULL on
        --                               receiver-side rows), and the
        --                               verifying key.
        --   * group_skipped_message_keys: derived; one row per
        --                               counter we leapfrogged on the
        --                               receive side. Consumed exactly
        --                               once and then deleted.
        --
        -- Atomicity rule: callers MUST persist a chain advance and the
        -- corresponding skipped-key inserts in the same SQLite
        -- transaction. Splitting them risks losing skipped rows after
        -- a crash, which would make the corresponding intermediate
        -- messages permanently undecryptable. apply_group_decrypt_outcome
        -- below is the only correct write path for receive flow.
        CREATE TABLE IF NOT EXISTS group_sender_keys (
            group_ulid     TEXT    NOT NULL,
            sender_did     TEXT    NOT NULL,
            sender_key_id  INTEGER NOT NULL,
            chain_key      BLOB    NOT NULL,
            counter        INTEGER NOT NULL,
            -- NULL for chains we received over an SKDM. NOT NULL for
            -- chains we mint locally (we are the sender for this row).
            -- Receivers MUST refuse to encrypt against rows whose seed
            -- is NULL -- enforced in the crypto layer, not in SQL.
            signing_seed   BLOB,
            verifying_key  BLOB    NOT NULL,
            updated_at     INTEGER NOT NULL,
            PRIMARY KEY (group_ulid, sender_did, sender_key_id)
        );
        CREATE INDEX IF NOT EXISTS idx_group_sender_keys_local
            ON group_sender_keys(group_ulid, sender_did, sender_key_id DESC)
            WHERE signing_seed IS NOT NULL;
        CREATE TABLE IF NOT EXISTS group_skipped_message_keys (
            group_ulid     TEXT    NOT NULL,
            sender_did     TEXT    NOT NULL,
            sender_key_id  INTEGER NOT NULL,
            counter        INTEGER NOT NULL,
            key            BLOB    NOT NULL,
            nonce          BLOB    NOT NULL,
            created_at     INTEGER NOT NULL,
            PRIMARY KEY (group_ulid, sender_did, sender_key_id, counter)
        );
        -- Group messages persisted locally with optional Sender Keys ciphertext.
        -- Pre-E2EE history stored plaintext in `content` only; post-G0 rows use
        -- `encrypted_payload` and pin `content` to '' (see group_chat send path).
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

fn wipe_legacy_group_plaintext_rows(conn: &Connection) -> Result<u64, String> {
    conn.execute(
        "UPDATE group_messages
         SET content = ''
         WHERE content IS NOT NULL AND content != ''
           AND (encrypted_payload IS NULL OR length(encrypted_payload) = 0)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.changes() as u64)
}

fn apply_one_time_migrations(conn: &Connection) -> Result<(), String> {
    apply_legacy_group_plaintext_wipe_v1(conn)?;
    apply_add_double_ratchet_columns_v1(conn)?;
    Ok(())
}

fn apply_legacy_group_plaintext_wipe_v1(conn: &Connection) -> Result<(), String> {
    let already: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_applied_migrations WHERE name = ?1",
            params![LEGACY_GROUP_PLAINTEXT_WIPE_MIGRATION],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if already > 0 {
        return Ok(());
    }
    let rows_wiped = wipe_legacy_group_plaintext_rows(conn)?;
    conn.execute(
        "INSERT INTO chat_applied_migrations(name, applied_at) VALUES (?1, ?2)",
        params![LEGACY_GROUP_PLAINTEXT_WIPE_MIGRATION, chrono_now()],
    )
    .map_err(|e| e.to_string())?;
    tracing::info!(
        migration = LEGACY_GROUP_PLAINTEXT_WIPE_MIGRATION,
        rows_wiped,
        "local_chat_store: wiped pre-E2EE group message plaintext bodies"
    );
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

#[cfg(test)]
pub(crate) fn test_migrate_schema_only(conn: &Connection) -> Result<(), String> {
    migrate_schema(conn)
}

#[cfg(test)]
pub(crate) fn test_apply_one_time_migrations(conn: &Connection) -> Result<(), String> {
    apply_one_time_migrations(conn)
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
            "save_dr_session: missing crypto_sessions row; persist CryptoSessionState (v=0) first"
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

// ---------------------------------------------------------------------------
// Sender Keys persistence
// ---------------------------------------------------------------------------
//
// Storage rules of thumb for callers:
//
//   * Receive path  -> ALWAYS go through `apply_group_decrypt_outcome`.
//     It wraps chain advance + new skipped-key inserts + (optional)
//     consumed-skipped-key delete in one SQLite transaction so a
//     crash mid-write cannot leave the chain ahead of its keys.
//
//   * Send path     -> save the advanced sender chain AND the just-used
//     message key in one `apply_group_decrypt_outcome` transaction before
//     returning ciphertext to the caller. The advanced chain prevents
//     AES-GCM key reuse; the persisted sent key lets the sender decrypt
//     their own history after a renderer reload drops the JS plaintext cache.
//
//   * Distribution -> `latest_local_sender_chain` returns the highest
//     `sender_key_id` we own for `(group, sender)`. SKDM emission
//     uses `snapshot_for_skdm` on the returned state.

/// Upsert a Sender-Keys chain row.
///
/// Caller controls whether `signing_seed` is `Some(_)` (we own the
/// chain) or `None` (received via SKDM). The DB does not second-guess
/// that distinction — see the schema comment for the invariant.
pub fn save_group_sender_chain(user_scope: &str, chain: &SenderChainState) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    save_group_sender_chain_with_conn(&conn, chain)
}

fn save_group_sender_chain_with_conn(
    conn: &Connection,
    chain: &SenderChainState,
) -> Result<(), String> {
    let now = chrono_now();
    let signing_seed = chain.signing_seed.as_ref().map(|s| s.as_slice());
    conn.execute(
        "INSERT INTO group_sender_keys(
            group_ulid, sender_did, sender_key_id,
            chain_key, counter, signing_seed, verifying_key, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(group_ulid, sender_did, sender_key_id) DO UPDATE SET
            chain_key      = excluded.chain_key,
            counter        = excluded.counter,
            -- Never *demote* a row from sender (Some signing_seed) to
            -- receiver (None) silently. The only path that nullifies
            -- signing_seed is an explicit `clear_local_signing_seed`
            -- helper (not exposed yet; future post-rotation cleanup).
            signing_seed   = COALESCE(excluded.signing_seed, group_sender_keys.signing_seed),
            verifying_key  = excluded.verifying_key,
            updated_at     = excluded.updated_at",
        params![
            chain.group_ulid,
            chain.sender_did,
            chain.sender_key_id as i64,
            chain.chain_key.as_ref(),
            chain.counter as i64,
            signing_seed,
            chain.verifying_key.as_ref(),
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn row_to_sender_chain(
    group_ulid: String,
    sender_did: String,
    sender_key_id: u32,
    chain_key_blob: Vec<u8>,
    counter: u32,
    signing_seed_blob: Option<Vec<u8>>,
    verifying_key_blob: Vec<u8>,
) -> Result<SenderChainState, String> {
    if chain_key_blob.len() != 32 {
        return Err("invalid chain_key length in group_sender_keys".to_string());
    }
    if verifying_key_blob.len() != 32 {
        return Err("invalid verifying_key length in group_sender_keys".to_string());
    }
    let mut chain_key = [0u8; 32];
    chain_key.copy_from_slice(&chain_key_blob);
    let mut verifying_key = [0u8; 32];
    verifying_key.copy_from_slice(&verifying_key_blob);
    let signing_seed = match signing_seed_blob {
        Some(b) if b.len() == 32 => {
            let mut a = [0u8; 32];
            a.copy_from_slice(&b);
            Some(a)
        }
        Some(_) => return Err("invalid signing_seed length in group_sender_keys".to_string()),
        None => None,
    };
    Ok(SenderChainState {
        group_ulid,
        sender_did,
        sender_key_id,
        chain_key,
        counter,
        signing_seed,
        verifying_key,
    })
}

/// Load a specific (group, sender, sender_key_id) chain. Returns
/// `Ok(None)` if no row exists -- typical when we haven't yet
/// processed the SKDM for that generation.
pub fn load_group_sender_chain(
    user_scope: &str,
    group_ulid: &str,
    sender_did: &str,
    sender_key_id: u32,
) -> Result<Option<SenderChainState>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let mut stmt = conn
        .prepare(
            "SELECT chain_key, counter, signing_seed, verifying_key
             FROM group_sender_keys
             WHERE group_ulid = ?1 AND sender_did = ?2 AND sender_key_id = ?3",
        )
        .map_err(|e| e.to_string())?;
    let row = stmt
        .query_row(params![group_ulid, sender_did, sender_key_id as i64], |r| {
            let chain_key_blob: Vec<u8> = r.get(0)?;
            let counter: i64 = r.get(1)?;
            let signing_seed_blob: Option<Vec<u8>> = r.get(2)?;
            let verifying_key_blob: Vec<u8> = r.get(3)?;
            Ok((
                chain_key_blob,
                counter as u32,
                signing_seed_blob,
                verifying_key_blob,
            ))
        })
        .optional()
        .map_err(|e| e.to_string())?;
    match row {
        None => Ok(None),
        Some((ck, counter, ss, vk)) => Ok(Some(row_to_sender_chain(
            group_ulid.to_string(),
            sender_did.to_string(),
            sender_key_id,
            ck,
            counter,
            ss,
            vk,
        )?)),
    }
}

/// Highest `sender_key_id` we have ever stored for `(group, sender)`,
/// regardless of whether we own the signing seed. Used by the
/// rotation path to mint the *next* generation: rotation MUST pick
/// `current + 1` so a newly-distributed SKDM cannot collide with a
/// chain we (or a peer) may already have stored under the same id.
/// Returns `Ok(None)` if no row exists for this pair.
pub fn max_sender_key_id(
    user_scope: &str,
    group_ulid: &str,
    sender_did: &str,
) -> Result<Option<u32>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    // SQLite's MAX over an empty set returns one row with a NULL
    // value, not zero rows -- so `.optional()` would still surface
    // a row, and a `r.get::<_, i64>(0)` on it errors with
    // "Invalid column type Null". We therefore read the column as
    // `Option<i64>` directly and let outer `Option` collapse the
    // "NULL but row exists" and "no row" cases into the same None.
    let row: Option<Option<i64>> = conn
        .query_row(
            "SELECT MAX(sender_key_id)
             FROM group_sender_keys
             WHERE group_ulid = ?1 AND sender_did = ?2",
            params![group_ulid, sender_did],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row.flatten().map(|v| v as u32))
}

/// Highest `sender_key_id` for which we own the signing seed. Used
/// by the send path: "what chain should I use to encrypt my next
/// message?". Returns `Ok(None)` when we have never emitted to this
/// group (the caller should mint a fresh chain via
/// `create_local_chain` and persist it before encrypting).
pub fn latest_local_sender_chain(
    user_scope: &str,
    group_ulid: &str,
    sender_did: &str,
) -> Result<Option<SenderChainState>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let mut stmt = conn
        .prepare(
            "SELECT sender_key_id, chain_key, counter, signing_seed, verifying_key
             FROM group_sender_keys
             WHERE group_ulid = ?1 AND sender_did = ?2 AND signing_seed IS NOT NULL
             ORDER BY sender_key_id DESC
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let row = stmt
        .query_row(params![group_ulid, sender_did], |r| {
            let sender_key_id: i64 = r.get(0)?;
            let chain_key_blob: Vec<u8> = r.get(1)?;
            let counter: i64 = r.get(2)?;
            let signing_seed_blob: Option<Vec<u8>> = r.get(3)?;
            let verifying_key_blob: Vec<u8> = r.get(4)?;
            Ok((
                sender_key_id as u32,
                chain_key_blob,
                counter as u32,
                signing_seed_blob,
                verifying_key_blob,
            ))
        })
        .optional()
        .map_err(|e| e.to_string())?;
    match row {
        None => Ok(None),
        Some((sender_key_id, ck, counter, ss, vk)) => Ok(Some(row_to_sender_chain(
            group_ulid.to_string(),
            sender_did.to_string(),
            sender_key_id,
            ck,
            counter,
            ss,
            vk,
        )?)),
    }
}

/// Load all skipped-message-keys for a single (group, sender,
/// sender_key_id), keyed by counter. Receive path uses this to
/// short-circuit OOO catch-up: if the inbound counter is already in
/// the map we decrypt straight from there without touching the
/// chain.
pub fn load_group_skipped_keys(
    user_scope: &str,
    group_ulid: &str,
    sender_did: &str,
    sender_key_id: u32,
) -> Result<BTreeMap<u32, SkippedMessageKey>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let mut stmt = conn
        .prepare(
            "SELECT counter, key, nonce
             FROM group_skipped_message_keys
             WHERE group_ulid = ?1 AND sender_did = ?2 AND sender_key_id = ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![group_ulid, sender_did, sender_key_id as i64], |r| {
            let counter: i64 = r.get(0)?;
            let key_blob: Vec<u8> = r.get(1)?;
            let nonce_blob: Vec<u8> = r.get(2)?;
            Ok((counter as u32, key_blob, nonce_blob))
        })
        .map_err(|e| e.to_string())?;
    let mut out: BTreeMap<u32, SkippedMessageKey> = BTreeMap::new();
    for row in rows {
        let (counter, key_blob, nonce_blob) = row.map_err(|e| e.to_string())?;
        if key_blob.len() != 32 || nonce_blob.len() != 12 {
            return Err("invalid skipped-key column lengths".to_string());
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&key_blob);
        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&nonce_blob);
        out.insert(
            counter,
            SkippedMessageKey {
                group_ulid: group_ulid.to_string(),
                sender_did: sender_did.to_string(),
                sender_key_id,
                counter,
                key,
                nonce,
            },
        );
    }
    Ok(out)
}

/// Atomic write for the receive path. Everything happens in one
/// transaction:
///
/// 1. Save the new chain state (`chain` already carries the bumped
///    counter / advanced chain key returned in `DecryptOutcome`).
/// 2. Insert any newly materialised skipped keys (no-op when the
///    decrypt was in-order).
/// 3. If the message we just decrypted *was* a skipped one,
///    `consumed_counter = Some(c)` deletes that row so the same
///    skipped key cannot be replayed.
///
/// Either everything lands or nothing does. The transaction is the
/// only correctness gate against the "chain advanced but skipped
/// rows lost" failure mode that would silently brick OOO recovery.
pub fn apply_group_decrypt_outcome(
    user_scope: &str,
    chain: &SenderChainState,
    new_skipped: &[SkippedMessageKey],
    consumed_counter: Option<u32>,
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    save_group_sender_chain_with_conn(&tx, chain)?;
    let now = chrono_now();
    for s in new_skipped {
        tx.execute(
            "INSERT OR IGNORE INTO group_skipped_message_keys(
                group_ulid, sender_did, sender_key_id, counter, key, nonce, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                s.group_ulid,
                s.sender_did,
                s.sender_key_id as i64,
                s.counter as i64,
                s.key.as_ref(),
                s.nonce.as_ref(),
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(c) = consumed_counter {
        tx.execute(
            "DELETE FROM group_skipped_message_keys
             WHERE group_ulid = ?1 AND sender_did = ?2
               AND sender_key_id = ?3 AND counter = ?4",
            params![
                chain.group_ulid,
                chain.sender_did,
                chain.sender_key_id as i64,
                c as i64
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod sender_key_tests {
    use super::*;
    use crate::domain::crypto::sender_keys::{
        consume_skdm, create_local_chain, current_message_key_snapshot, decrypt, encrypt,
        snapshot_for_skdm,
    };

    fn unique_scope(tag: &str) -> String {
        format!(
            "test-sk-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    #[test]
    fn round_trip_with_persistence() {
        // End-to-end: a sender chain we mint locally is persisted
        // and re-loaded; the same persistence path on the receiver
        // side replays our SKDM and decrypts an OOO sequence.
        let scope_s = unique_scope("send");
        let scope_r = unique_scope("recv");

        let mut local = create_local_chain("g-1", "did:peers:alice", 1);
        save_group_sender_chain(&scope_s, &local).unwrap();
        let reloaded = latest_local_sender_chain(&scope_s, "g-1", "did:peers:alice")
            .unwrap()
            .expect("chain present");
        assert_eq!(reloaded.sender_key_id, 1);
        assert_eq!(reloaded.counter, 0);
        assert!(reloaded.signing_seed.is_some());

        // Distribute to receiver via SKDM.
        let payload = snapshot_for_skdm(&local);
        let recv = consume_skdm(&payload).unwrap();
        save_group_sender_chain(&scope_r, &recv).unwrap();

        // Sender produces three messages out of order in receive.
        let m0 = encrypt(&mut local, b"a").unwrap();
        let m1 = encrypt(&mut local, b"b").unwrap();
        let m2 = encrypt(&mut local, b"c").unwrap();
        save_group_sender_chain(&scope_s, &local).unwrap();

        // Receive m2 first.
        let recv_state = load_group_sender_chain(&scope_r, "g-1", "did:peers:alice", 1)
            .unwrap()
            .unwrap();
        let pre = load_group_skipped_keys(&scope_r, "g-1", "did:peers:alice", 1).unwrap();
        let out2 = decrypt(&recv_state, &m2, &pre).unwrap();
        assert_eq!(out2.plaintext, b"c");
        assert_eq!(out2.new_skipped.len(), 2);

        let advanced = SenderChainState {
            group_ulid: recv_state.group_ulid.clone(),
            sender_did: recv_state.sender_did.clone(),
            sender_key_id: recv_state.sender_key_id,
            chain_key: out2.advanced_chain_key,
            counter: out2.advanced_counter,
            signing_seed: recv_state.signing_seed,
            verifying_key: recv_state.verifying_key,
        };
        apply_group_decrypt_outcome(&scope_r, &advanced, &out2.new_skipped, None).unwrap();

        // m0 arrives late and decrypts from the persisted skipped-key store.
        let recv_state2 = load_group_sender_chain(&scope_r, "g-1", "did:peers:alice", 1)
            .unwrap()
            .unwrap();
        let pre2 = load_group_skipped_keys(&scope_r, "g-1", "did:peers:alice", 1).unwrap();
        assert!(pre2.contains_key(&0));
        let out0 = decrypt(&recv_state2, &m0, &pre2).unwrap();
        assert_eq!(out0.plaintext, b"a");
        // After consuming m0, delete the row.
        apply_group_decrypt_outcome(&scope_r, &recv_state2, &[], Some(0)).unwrap();
        let pre3 = load_group_skipped_keys(&scope_r, "g-1", "did:peers:alice", 1).unwrap();
        assert!(!pre3.contains_key(&0));
        assert!(pre3.contains_key(&1));

        // m1 also decrypts.
        let out1 = decrypt(&recv_state2, &m1, &pre3).unwrap();
        assert_eq!(out1.plaintext, b"b");
    }

    #[test]
    fn self_authored_message_key_survives_reload() {
        let scope = unique_scope("self-history");

        let mut local = create_local_chain("g-self", "did:peers:alice", 1);
        save_group_sender_chain(&scope, &local).unwrap();

        let sent_key = current_message_key_snapshot(&local);
        let wire = encrypt(&mut local, b"self-authored").unwrap();
        apply_group_decrypt_outcome(&scope, &local, &[sent_key], None).unwrap();

        // Simulate a new renderer/webview: only the advanced chain and
        // persisted skipped-key table remain. Counter 0 is now behind the
        // chain, so decrypt must use the saved sent key.
        let reloaded = load_group_sender_chain(&scope, "g-self", "did:peers:alice", 1)
            .unwrap()
            .expect("reloaded sender chain");
        assert_eq!(reloaded.counter, 1);
        let pre = load_group_skipped_keys(&scope, "g-self", "did:peers:alice", 1).unwrap();
        assert!(pre.contains_key(&0));

        let out = decrypt(&reloaded, &wire, &pre).unwrap();
        assert_eq!(out.plaintext, b"self-authored");

        // Self-authored history is not a network replay attempt. The command
        // layer must leave the key available for future reloads.
        apply_group_decrypt_outcome(&scope, &reloaded, &[], None).unwrap();
        let pre_after = load_group_skipped_keys(&scope, "g-self", "did:peers:alice", 1).unwrap();
        assert!(pre_after.contains_key(&0));
    }

    #[test]
    fn max_sender_key_id_drives_rotation_collision_avoidance() {
        // Forced rotation must mint at `max + 1`. The helper has
        // to consider EVERY row -- ours, peers', stale ones --
        // because the rotation generation is shared globally
        // across the (group, sender) pair. A simple "pick latest
        // owned chain" would let a peer's higher generation
        // collide.
        let scope = unique_scope("rotmax");
        let group = "g-rot";
        let me = "did:peers:rotor";
        // No rows yet -- caller treats None as "start at 1".
        assert!(max_sender_key_id(&scope, group, me).unwrap().is_none());

        // Three local chains at 1, 5, 3. max should be 5 regardless
        // of insert order.
        for kid in [1u32, 5, 3] {
            let chain = create_local_chain(group, me, kid);
            save_group_sender_chain(&scope, &chain).unwrap();
        }
        assert_eq!(max_sender_key_id(&scope, group, me).unwrap(), Some(5));

        // A different (group, sender) tuple is isolated -- the
        // rotation generation is per-pair, not per-actor.
        let other = create_local_chain(group, "did:peers:other", 99);
        save_group_sender_chain(&scope, &other).unwrap();
        assert_eq!(max_sender_key_id(&scope, group, me).unwrap(), Some(5));
        assert_eq!(
            max_sender_key_id(&scope, group, "did:peers:other").unwrap(),
            Some(99)
        );
    }

    #[test]
    fn signing_seed_is_not_silently_clobbered() {
        // A stray "I just got an SKDM for my own chain" upsert
        // (signing_seed = None) MUST NOT erase the seed of a row we
        // own. Without this guard a spurious echo of our own
        // distribution would lock us out of our own chain.
        let scope = unique_scope("noclobber");
        let local = create_local_chain("g-9", "did:peers:gus", 1);
        save_group_sender_chain(&scope, &local).unwrap();
        let payload = snapshot_for_skdm(&local);
        let recv_view = consume_skdm(&payload).unwrap();
        save_group_sender_chain(&scope, &recv_view).unwrap();
        let after = load_group_sender_chain(&scope, "g-9", "did:peers:gus", 1)
            .unwrap()
            .unwrap();
        assert!(after.signing_seed.is_some());
    }
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

#[cfg(test)]
mod migration_tests {
    use super::{test_apply_one_time_migrations, test_migrate_schema_only};
    use crate::domain::storage::database::DatabaseOpenSpec;
    use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
    use crate::infrastructure::storage::open_database;
    use rusqlite::params;

    fn unique_scope(tag: &str) -> String {
        format!(
            "test-mig-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    #[test]
    fn legacy_group_plaintext_wipe_runs_once_and_is_idempotent() {
        let scope = unique_scope("plain");
        let spec = DatabaseOpenSpec::new_chat_main(scope);
        let conn =
            open_database(&spec, PlatformKeyProvider::shared()).expect("open_database(chat/main)");

        test_migrate_schema_only(&conn).expect("schema migration");

        let legacy_ulid = "01HXTESTLEGACY000000000000";
        let sk_ulid = "01HXTESTPOSTSK000000000000";
        let ciphertext: Vec<u8> = vec![0x01, 0x02, 0xde, 0xad];

        conn.execute(
            "INSERT INTO group_messages(ulid, group_ulid, sender_did, content, encrypted_payload, sent_at)
             VALUES (?1, 'g1', 'did:legacy', 'secret plaintext', NULL, 1000)",
            params![legacy_ulid],
        )
        .expect("insert legacy row");
        conn.execute(
            "INSERT INTO group_messages(ulid, group_ulid, sender_did, content, encrypted_payload, sent_at)
             VALUES (?1, 'g1', 'did:sk', '', ?2, 2000)",
            params![sk_ulid, ciphertext.as_slice()],
        )
        .expect("insert sender-key row");

        test_apply_one_time_migrations(&conn).expect("first one-time migration");

        let leg_content: String = conn
            .query_row(
                "SELECT content FROM group_messages WHERE ulid = ?1",
                params![legacy_ulid],
                |r| r.get(0),
            )
            .expect("read legacy content");
        assert_eq!(leg_content, "");

        let sk_payload: Vec<u8> = conn
            .query_row(
                "SELECT encrypted_payload FROM group_messages WHERE ulid = ?1",
                params![sk_ulid],
                |r| r.get(0),
            )
            .expect("read sk ciphertext");
        assert_eq!(sk_payload, ciphertext);

        test_apply_one_time_migrations(&conn).expect("second one-time migration");

        let leg_content_2: String = conn
            .query_row(
                "SELECT content FROM group_messages WHERE ulid = ?1",
                params![legacy_ulid],
                |r| r.get(0),
            )
            .expect("read legacy after second migration");
        assert_eq!(leg_content_2, "");

        let sk_payload_2: Vec<u8> = conn
            .query_row(
                "SELECT encrypted_payload FROM group_messages WHERE ulid = ?1",
                params![sk_ulid],
                |r| r.get(0),
            )
            .expect("read sk ciphertext after second migration");
        assert_eq!(sk_payload_2, ciphertext);
    }
}
