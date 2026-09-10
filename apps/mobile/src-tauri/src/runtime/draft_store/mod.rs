// Encrypted Chat / Moments draft store (MS-P08).
//
// Drafts persist across app restarts so the user does not lose
// in-progress message composition or moment post authoring.
// Like the command ledger, payloads are AES-256-GCM encrypted
// at rest.  The draft store is keyed by `{kind}:{domain_key}`
// so each conversation / moment post has exactly one active draft.
//
// The lifecycle kernel (W3) consumes the draft restoration port
// to pre-fill editors after app resume or cold start.

pub mod types;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand::RngCore;
use rusqlite::{params, Connection};
use sha2::Sha256;

use self::types::{DraftKind, DraftProjection};
use crate::error::{MobileError, MobileResult};

/// Top-level draft store managed as Tauri application state.
pub struct DraftStore {
    inner: Mutex<Option<DraftStoreInner>>,
}

struct DraftStoreInner {
    conn: Connection,
    cipher: Aes256Gcm,
}

impl DraftStore {
    /// Create an uninitialized draft store.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Initialize with a database directory and encryption secret.
    pub fn initialize(&self, db_dir: &PathBuf, encryption_secret: &[u8]) -> MobileResult<()> {
        let db_path = db_dir.join("draft_store.db");

        let conn = Connection::open(&db_path)
            .map_err(|e| MobileError::draft(format!("failed to open draft db: {e}")))?;

        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .map_err(|e| MobileError::draft(format!("failed to set WAL mode: {e}")))?;

        run_draft_migrations(&conn)?;

        let cipher = derive_draft_cipher(encryption_secret)?;

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::draft("draft store lock poisoned".to_string()))?;

        *guard = Some(DraftStoreInner { conn, cipher });

        log::info!("draft_store: initialized");
        Ok(())
    }

    /// Save (upsert) a draft.  Replaces any existing draft with the same key.
    pub fn save(&self, kind: DraftKind, domain_key: &str, payload_json: &str) -> MobileResult<()> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::draft("draft store lock poisoned".to_string()))?;

        let inner = guard
            .as_ref()
            .ok_or_else(|| MobileError::draft("draft store not initialized".to_string()))?;

        let composite_key = format!("{}:{}", kind.as_str(), domain_key);
        let now_ms = current_time_ms();
        let encrypted = encrypt_payload(&inner.cipher, payload_json.as_bytes())?;

        inner
            .conn
            .execute(
                "INSERT INTO drafts (key, kind, payload_blob, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(key) DO UPDATE SET
                     payload_blob = excluded.payload_blob,
                     updated_at_ms = excluded.updated_at_ms",
                params![composite_key, kind.as_str(), encrypted, now_ms],
            )
            .map_err(|e| MobileError::draft(format!("draft save failed: {e}")))?;

        Ok(())
    }

    /// Load a draft by composite key.
    pub fn load(&self, kind: DraftKind, domain_key: &str) -> MobileResult<Option<DraftProjection>> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::draft("draft store lock poisoned".to_string()))?;

        let inner = guard
            .as_ref()
            .ok_or_else(|| MobileError::draft("draft store not initialized".to_string()))?;

        let composite_key = format!("{}:{}", kind.as_str(), domain_key);

        let result = inner.conn.query_row(
            "SELECT key, kind, payload_blob, updated_at_ms FROM drafts WHERE key = ?1",
            params![composite_key],
            |row| {
                Ok(RawDraftRow {
                    key: row.get(0)?,
                    kind: row.get(1)?,
                    payload_blob: row.get(2)?,
                    updated_at_ms: row.get(3)?,
                })
            },
        );

        match result {
            Ok(raw) => {
                let decrypted = decrypt_payload(&inner.cipher, &raw.payload_blob)?;
                let payload_json = String::from_utf8(decrypted).map_err(|e| {
                    MobileError::draft(format!("draft payload not valid UTF-8: {e}"))
                })?;

                let kind = DraftKind::from_str(&raw.kind).ok_or_else(|| {
                    MobileError::draft(format!("unknown draft kind: {}", raw.kind))
                })?;

                Ok(Some(DraftProjection {
                    key: raw.key,
                    kind,
                    payload_json,
                    updated_at_ms: raw.updated_at_ms as u64,
                }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(MobileError::draft(format!("draft load failed: {e}"))),
        }
    }

    /// List all drafts of a given kind.
    pub fn list_by_kind(&self, kind: DraftKind) -> MobileResult<Vec<DraftProjection>> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::draft("draft store lock poisoned".to_string()))?;

        let inner = guard
            .as_ref()
            .ok_or_else(|| MobileError::draft("draft store not initialized".to_string()))?;

        let mut stmt = inner
            .conn
            .prepare(
                "SELECT key, kind, payload_blob, updated_at_ms
                 FROM drafts WHERE kind = ?1 ORDER BY updated_at_ms DESC",
            )
            .map_err(|e| MobileError::draft(format!("prepare list failed: {e}")))?;

        let rows = stmt
            .query_map(params![kind.as_str()], |row| {
                Ok(RawDraftRow {
                    key: row.get(0)?,
                    kind: row.get(1)?,
                    payload_blob: row.get(2)?,
                    updated_at_ms: row.get(3)?,
                })
            })
            .map_err(|e| MobileError::draft(format!("list query failed: {e}")))?;

        let mut projections = Vec::new();
        for raw_result in rows {
            let raw =
                raw_result.map_err(|e| MobileError::draft(format!("row read failed: {e}")))?;
            let decrypted = decrypt_payload(&inner.cipher, &raw.payload_blob)?;
            let payload_json = String::from_utf8(decrypted)
                .map_err(|e| MobileError::draft(format!("draft payload not valid UTF-8: {e}")))?;

            let draft_kind = DraftKind::from_str(&raw.kind)
                .ok_or_else(|| MobileError::draft(format!("unknown draft kind: {}", raw.kind)))?;

            projections.push(DraftProjection {
                key: raw.key,
                kind: draft_kind,
                payload_json,
                updated_at_ms: raw.updated_at_ms as u64,
            });
        }

        Ok(projections)
    }

    /// Remove a draft by composite key.
    pub fn remove(&self, kind: DraftKind, domain_key: &str) -> MobileResult<()> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::draft("draft store lock poisoned".to_string()))?;

        let inner = guard
            .as_ref()
            .ok_or_else(|| MobileError::draft("draft store not initialized".to_string()))?;

        let composite_key = format!("{}:{}", kind.as_str(), domain_key);

        inner
            .conn
            .execute("DELETE FROM drafts WHERE key = ?1", params![composite_key])
            .map_err(|e| MobileError::draft(format!("draft remove failed: {e}")))?;

        Ok(())
    }

    /// Shutdown the draft store.
    pub fn shutdown(&self) -> MobileResult<()> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::draft("draft store lock poisoned".to_string()))?;

        *guard = None;
        log::info!("draft_store: shut down");
        Ok(())
    }

    /// Count all drafts across all kinds.
    ///
    /// Used by the background reconciliation bridge to build a report
    /// without decrypting or materializing full entries.
    pub fn count_all(&self) -> MobileResult<u64> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| MobileError::draft("draft store lock poisoned".to_string()))?;

        let inner = match guard.as_ref() {
            Some(inner) => inner,
            // Draft store not initialized — report zero count
            None => return Ok(0),
        };

        let count: u64 = inner
            .conn
            .query_row("SELECT COUNT(*) FROM drafts", [], |row| row.get(0))
            .map_err(|e| MobileError::draft(format!("draft count failed: {e}")))?;

        Ok(count)
    }
}

// --- internal helpers ---

struct RawDraftRow {
    key: String,
    kind: String,
    payload_blob: Vec<u8>,
    updated_at_ms: i64,
}

fn run_draft_migrations(conn: &Connection) -> MobileResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS draft_schema_version (
            id      INTEGER PRIMARY KEY CHECK (id = 1),
            version INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO draft_schema_version (id, version) VALUES (1, 0);",
    )
    .map_err(|e| MobileError::draft(format!("failed to create schema_version: {e}")))?;

    let current: u32 = conn
        .query_row(
            "SELECT version FROM draft_schema_version WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| MobileError::draft(format!("failed to read schema version: {e}")))?;

    if current < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS drafts (
                key             TEXT PRIMARY KEY NOT NULL,
                kind            TEXT NOT NULL,
                payload_blob    BLOB NOT NULL,
                updated_at_ms   INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_drafts_kind
                ON drafts(kind);",
        )
        .map_err(|e| MobileError::draft(format!("draft migration v1 failed: {e}")))?;

        conn.execute(
            "UPDATE draft_schema_version SET version = 1 WHERE id = 1",
            [],
        )
        .map_err(|e| MobileError::draft(format!("failed to update schema version: {e}")))?;

        log::info!("draft_store: applied migration v1");
    }

    Ok(())
}

fn derive_draft_cipher(secret: &[u8]) -> MobileResult<Aes256Gcm> {
    let hk = Hkdf::<Sha256>::new(Some(b"peers-touch-draft-store"), secret);
    let mut key_bytes = [0u8; 32];
    hk.expand(b"draft-store-aes256gcm", &mut key_bytes)
        .map_err(|e| MobileError::draft(format!("HKDF expand failed: {e}")))?;

    Ok(Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| MobileError::draft(format!("AES key init failed: {e}")))?)
}

fn encrypt_payload(cipher: &Aes256Gcm, plaintext: &[u8]) -> MobileResult<Vec<u8>> {
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| MobileError::draft(format!("draft encryption failed: {e}")))?;

    let mut blob = Vec::with_capacity(12 + ciphertext.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend(ciphertext);
    Ok(blob)
}

fn decrypt_payload(cipher: &Aes256Gcm, blob: &[u8]) -> MobileResult<Vec<u8>> {
    if blob.len() < 12 {
        return Err(MobileError::draft(
            "draft payload blob too short for nonce".to_string(),
        ));
    }

    let (nonce_bytes, ciphertext) = blob.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| MobileError::draft(format!("draft decryption failed: {e}")))
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
