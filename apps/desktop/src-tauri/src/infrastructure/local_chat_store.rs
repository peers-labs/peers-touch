use super::storage::key_provider::PlatformKeyProvider;
use super::storage::get_database_key_version;
use super::storage::open_database;
use super::storage::rotate_database_key;
use crate::domain::crypto::CryptoSessionState;
use crate::domain::storage::database::DatabaseOpenSpec;
use rusqlite::{params, Connection, OptionalExtension};
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
            search_local_single(&conn, scope_trim.unwrap(), conversation_id, query, limit)
        }
        None => {
            let conn = open_connection(user_scope)?;
            let friend = search_local_single(&conn, "friend", conversation_id, query, limit)?;
            let group = search_local_single(&conn, "group", conversation_id, query, limit)?;
            Ok(merge_desc_by_sent_at(friend, group, limit))
        }
        Some(other) => Err(format!("unsupported chat search scope: {other}")),
    }
}

pub fn save_crypto_session(user_scope: &str, session: &CryptoSessionState) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
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

/// Persist the local group symmetric key (32-byte blob) and ratchet counters for AES-GCM.
pub fn save_group_key(
    user_scope: &str,
    group_id: &str,
    key: &[u8; 32],
    epoch: u32,
    counter: u32,
) -> Result<(), String> {
    let conn = open_connection(user_scope)?;
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
