use super::storage::key_provider::PlatformKeyProvider;
use super::storage::get_database_key_version;
use super::storage::open_database;
use super::storage::rotate_database_key;
use crate::domain::crypto::CryptoSessionState;
use crate::domain::storage::database::DatabaseOpenSpec;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatRecord {
    pub scope: String,
    pub conversation_id: String,
    pub message_id: String,
    pub sender_did: String,
    pub content: String,
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
        self.arc.lock().expect("local_chat_store conn pool poisoned")
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
    let entry = map.entry(user_scope.to_string()).or_insert_with(|| arc.clone());
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
        CREATE TABLE IF NOT EXISTS crypto_group_keys (
            group_id TEXT NOT NULL PRIMARY KEY,
            key_data BLOB NOT NULL,
            epoch INTEGER NOT NULL DEFAULT 1,
            counter INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
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
    let conn = conn.lock();
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
    let conn = conn.lock();
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

fn merge_desc_by_sent_at(a: Vec<LocalChatRecord>, b: Vec<LocalChatRecord>, limit: usize) -> Vec<LocalChatRecord> {
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
    let mut out = Vec::new();
    if let Some(conv) = conversation_id.filter(|c| !c.trim().is_empty()) {
        let mut stmt = conn
            .prepare(
                "SELECT m.scope, m.conversation_id, m.message_id, m.sender_did, m.content, m.sent_at
                 FROM chat_messages_fts f
                 JOIN chat_messages m ON m.message_id = f.message_id
                 WHERE f.scope = ?1 AND m.conversation_id = ?2 AND chat_messages_fts MATCH ?3
                 ORDER BY m.sent_at DESC
                 LIMIT ?4",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![scope, conv, query, limit as i64], |row| {
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
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        return Ok(out);
    }
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
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
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

pub fn load_crypto_session(user_scope: &str, session_id: &str) -> Result<Option<CryptoSessionState>, String> {
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
    let Some((peer_did, send_blob, send_counter, recv_blob, recv_counter, established, is_initiator, pending)) =
        row
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

/// Store signed pre-key material for later X3DH receive paths.
pub fn crypto_store_signed_prekey(user_scope: &str, id: i64, private_key: &[u8]) -> Result<(), String> {
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

/// FTS5 search with optional `scope` (`friend` / `group`) and `conversation_id` filters (empty = no filter).
pub fn search_local_unified(
    user_scope: &str,
    fts_query: &str,
    scope_filter: &str,
    conversation_id: &str,
    limit: usize,
) -> Result<Vec<LocalChatRecord>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let mut stmt = conn
        .prepare(
            "SELECT m.scope, m.conversation_id, m.message_id, m.sender_did, m.content, m.sent_at
             FROM chat_messages_fts f
             JOIN chat_messages m ON m.message_id = f.message_id
             WHERE f MATCH ?1
               AND (?2 = '' OR m.scope = ?2)
               AND (?3 = '' OR m.conversation_id = ?3)
             ORDER BY m.sent_at DESC
             LIMIT ?4",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![fts_query, scope_filter, conversation_id, limit as i64],
            |row| {
                Ok(LocalChatRecord {
                    scope: row.get(0)?,
                    conversation_id: row.get(1)?,
                    message_id: row.get(2)?,
                    sender_did: row.get(3)?,
                    content: row.get(4)?,
                    sent_at: row.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
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

/// Persist the local group symmetric key (32-byte blob) and ratchet counters for AES-GCM.
pub fn save_group_key(
    user_scope: &str,
    group_id: &str,
    key: &[u8; 32],
    epoch: u32,
    counter: u32,
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let now = chrono_now();
    let created_at: i64 = conn
        .query_row(
            "SELECT created_at FROM crypto_group_keys WHERE group_id = ?1",
            params![group_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(now);
    conn.execute(
        "INSERT INTO crypto_group_keys(group_id, key_data, epoch, counter, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(group_id) DO UPDATE SET
           key_data=excluded.key_data,
           epoch=excluded.epoch,
           counter=excluded.counter,
           updated_at=excluded.updated_at",
        params![
            group_id,
            key.as_slice(),
            epoch as i64,
            counter as i64,
            created_at,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Load group key material and counters, if present.
pub fn load_group_key(
    user_scope: &str,
    group_id: &str,
) -> Result<Option<(Vec<u8>, u32, u32)>, String> {
    let conn = open_connection(user_scope)?;
    let conn = conn.lock();
    let row = conn
        .query_row(
            "SELECT key_data, epoch, counter FROM crypto_group_keys WHERE group_id = ?1",
            params![group_id],
            |row| {
                let key_data: Vec<u8> = row.get(0)?;
                let epoch: i64 = row.get(1)?;
                let counter: i64 = row.get(2)?;
                Ok((key_data, epoch as u32, counter as u32))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row)
}
