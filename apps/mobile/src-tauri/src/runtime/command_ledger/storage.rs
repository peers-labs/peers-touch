// Encrypted SQLite-backed persistence for the command ledger.
//
// Payloads are encrypted with AES-256-GCM before being written to
// the `payload_blob` column.  The encryption key is derived from a
// caller-supplied secret via HKDF-SHA256.  On startup, any entry
// still in `Pending` status is promoted to `Unknown` to surface
// crash-recovery state to the UI.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand::RngCore;
use rusqlite::{params, Connection};
use sha2::Sha256;

use super::entry::{CommandCategory, CommandEntry, CommandStatus};
use super::migration;
use crate::error::{MobileError, MobileResult};

/// Maximum number of entries allowed in the ledger.
/// Beyond this limit, `admit` returns a capacity error.
const MAX_LEDGER_ENTRIES: usize = 2000;

/// SQLite storage backend for the command ledger.
pub struct LedgerStorage {
    conn: Connection,
    cipher: Aes256Gcm,
}

impl LedgerStorage {
    /// Open (or create) the ledger database at `db_path`.
    ///
    /// `encryption_secret` is fed through HKDF to derive the
    /// AES-256-GCM key used for payload encryption.
    pub fn open(db_path: &Path, encryption_secret: &[u8]) -> MobileResult<Self> {
        let conn = Connection::open(db_path)
            .map_err(|e| MobileError::ledger(format!("failed to open ledger db: {e}")))?;

        // WAL mode for better concurrent read performance and crash safety.
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .map_err(|e| MobileError::ledger(format!("failed to set WAL mode: {e}")))?;

        migration::run_migrations(&conn)?;

        let cipher = derive_cipher(encryption_secret)?;

        let mut storage = Self { conn, cipher };
        storage.recover_from_crash()?;

        Ok(storage)
    }

    /// Mark all `Pending` entries as `Unknown`.
    ///
    /// Called once at startup so the UI can surface entries whose
    /// outcome is indeterminate after an app crash or kill.
    fn recover_from_crash(&mut self) -> MobileResult<()> {
        let now_ms = current_time_ms();
        let affected = self
            .conn
            .execute(
                "UPDATE command_entries SET status = ?1, updated_at_ms = ?2 WHERE status = ?3",
                params![
                    CommandStatus::Unknown.as_str(),
                    now_ms,
                    CommandStatus::Pending.as_str(),
                ],
            )
            .map_err(|e| MobileError::ledger(format!("crash recovery failed: {e}")))?;

        if affected > 0 {
            log::warn!(
                "command_ledger: crash recovery promoted {} pending entries to unknown",
                affected,
            );
        }

        Ok(())
    }

    /// Persist a new command entry.  Returns a capacity error if the
    /// ledger already contains `MAX_LEDGER_ENTRIES`.
    pub fn insert(&self, entry: &CommandEntry) -> MobileResult<()> {
        let count = self.count_all()?;
        if count >= MAX_LEDGER_ENTRIES {
            return Err(MobileError::ledger(format!(
                "ledger capacity exceeded: {count}/{MAX_LEDGER_ENTRIES}",
            )));
        }

        let encrypted_payload = self.encrypt_payload(entry.payload_json.as_bytes())?;

        self.conn
            .execute(
                "INSERT INTO command_entries
                    (id, category, command_type, ordering_key, status,
                     payload_blob, created_at_ms, updated_at_ms, attempt_count, failure_reason)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    entry.id,
                    entry.category.as_str(),
                    entry.command_type,
                    entry.ordering_key,
                    entry.status.as_str(),
                    encrypted_payload,
                    entry.created_at_ms,
                    entry.updated_at_ms,
                    entry.attempt_count,
                    entry.failure_reason,
                ],
            )
            .map_err(|e| MobileError::ledger(format!("insert failed: {e}")))?;

        Ok(())
    }

    /// Transition a command to a new status.
    pub fn update_status(
        &self,
        id: &str,
        new_status: CommandStatus,
        failure_reason: Option<&str>,
    ) -> MobileResult<()> {
        let now_ms = current_time_ms();
        let affected = self
            .conn
            .execute(
                "UPDATE command_entries
                 SET status = ?1, updated_at_ms = ?2, failure_reason = ?3,
                     attempt_count = attempt_count + 1
                 WHERE id = ?4",
                params![new_status.as_str(), now_ms, failure_reason, id],
            )
            .map_err(|e| MobileError::ledger(format!("status update failed: {e}")))?;

        if affected == 0 {
            return Err(MobileError::ledger(format!(
                "command entry not found: {id}",
            )));
        }

        Ok(())
    }

    /// Retrieve a single entry by ID, decrypting its payload.
    pub fn get(&self, id: &str) -> MobileResult<Option<CommandEntry>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, category, command_type, ordering_key, status,
                        payload_blob, created_at_ms, updated_at_ms, attempt_count, failure_reason
                 FROM command_entries WHERE id = ?1",
            )
            .map_err(|e| MobileError::ledger(format!("prepare get failed: {e}")))?;

        let entry = stmt
            .query_row(params![id], |row| {
                Ok(RawRow {
                    id: row.get(0)?,
                    category: row.get(1)?,
                    command_type: row.get(2)?,
                    ordering_key: row.get(3)?,
                    status: row.get(4)?,
                    payload_blob: row.get(5)?,
                    created_at_ms: row.get(6)?,
                    updated_at_ms: row.get(7)?,
                    attempt_count: row.get(8)?,
                    failure_reason: row.get(9)?,
                })
            })
            .optional()
            .map_err(|e| MobileError::ledger(format!("get failed: {e}")))?;

        match entry {
            Some(raw) => Ok(Some(self.raw_to_entry(raw)?)),
            None => Ok(None),
        }
    }

    /// List entries filtered by status, ordered by creation time.
    pub fn list_by_status(&self, status: CommandStatus) -> MobileResult<Vec<CommandEntry>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, category, command_type, ordering_key, status,
                        payload_blob, created_at_ms, updated_at_ms, attempt_count, failure_reason
                 FROM command_entries WHERE status = ?1
                 ORDER BY created_at_ms ASC",
            )
            .map_err(|e| MobileError::ledger(format!("prepare list failed: {e}")))?;

        let rows = stmt
            .query_map(params![status.as_str()], |row| {
                Ok(RawRow {
                    id: row.get(0)?,
                    category: row.get(1)?,
                    command_type: row.get(2)?,
                    ordering_key: row.get(3)?,
                    status: row.get(4)?,
                    payload_blob: row.get(5)?,
                    created_at_ms: row.get(6)?,
                    updated_at_ms: row.get(7)?,
                    attempt_count: row.get(8)?,
                    failure_reason: row.get(9)?,
                })
            })
            .map_err(|e| MobileError::ledger(format!("list query failed: {e}")))?;

        let mut entries = Vec::new();
        for raw_result in rows {
            let raw = raw_result
                .map_err(|e| MobileError::ledger(format!("row read failed: {e}")))?;
            entries.push(self.raw_to_entry(raw)?);
        }

        Ok(entries)
    }

    /// List entries by ordering key and status.
    pub fn list_by_ordering_key(
        &self,
        ordering_key: &str,
        status: Option<CommandStatus>,
    ) -> MobileResult<Vec<CommandEntry>> {
        let (sql, status_filter);
        if let Some(s) = status {
            sql = "SELECT id, category, command_type, ordering_key, status,
                          payload_blob, created_at_ms, updated_at_ms, attempt_count, failure_reason
                   FROM command_entries WHERE ordering_key = ?1 AND status = ?2
                   ORDER BY created_at_ms ASC";
            status_filter = Some(s);
        } else {
            sql = "SELECT id, category, command_type, ordering_key, status,
                          payload_blob, created_at_ms, updated_at_ms, attempt_count, failure_reason
                   FROM command_entries WHERE ordering_key = ?1
                   ORDER BY created_at_ms ASC";
            status_filter = None;
        }

        let mut stmt = self
            .conn
            .prepare(sql)
            .map_err(|e| MobileError::ledger(format!("prepare list_by_ordering_key failed: {e}")))?;

        let rows = if let Some(s) = status_filter {
            stmt.query_map(params![ordering_key, s.as_str()], row_mapper)
        } else {
            stmt.query_map(params![ordering_key], row_mapper)
        }
        .map_err(|e| MobileError::ledger(format!("list_by_ordering_key query failed: {e}")))?;

        let mut entries = Vec::new();
        for raw_result in rows {
            let raw = raw_result
                .map_err(|e| MobileError::ledger(format!("row read failed: {e}")))?;
            entries.push(self.raw_to_entry(raw)?);
        }

        Ok(entries)
    }

    /// Remove entries by status (e.g. purge committed entries).
    pub fn purge_by_status(&self, status: CommandStatus) -> MobileResult<usize> {
        let affected = self
            .conn
            .execute(
                "DELETE FROM command_entries WHERE status = ?1",
                params![status.as_str()],
            )
            .map_err(|e| MobileError::ledger(format!("purge failed: {e}")))?;

        Ok(affected)
    }

    /// Total entry count across all statuses.
    pub fn count_all(&self) -> MobileResult<usize> {
        let count: u64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM command_entries", [], |row| row.get(0))
            .map_err(|e| MobileError::ledger(format!("count failed: {e}")))?;

        Ok(count as usize)
    }

    // --- encryption helpers ---

    fn encrypt_payload(&self, plaintext: &[u8]) -> MobileResult<Vec<u8>> {
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| MobileError::ledger(format!("payload encryption failed: {e}")))?;

        // Prepend the 12-byte nonce to the ciphertext.
        let mut blob = Vec::with_capacity(12 + ciphertext.len());
        blob.extend_from_slice(&nonce_bytes);
        blob.extend(ciphertext);
        Ok(blob)
    }

    fn decrypt_payload(&self, blob: &[u8]) -> MobileResult<Vec<u8>> {
        if blob.len() < 12 {
            return Err(MobileError::ledger(
                "payload blob too short for nonce".to_string(),
            ));
        }

        let (nonce_bytes, ciphertext) = blob.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| MobileError::ledger(format!("payload decryption failed: {e}")))
    }

    // --- row mapping helpers ---

    fn raw_to_entry(&self, raw: RawRow) -> MobileResult<CommandEntry> {
        let payload_bytes = self.decrypt_payload(&raw.payload_blob)?;
        let payload_json = String::from_utf8(payload_bytes)
            .map_err(|e| MobileError::ledger(format!("payload is not valid UTF-8: {e}")))?;

        let category = CommandCategory::from_str(&raw.category).ok_or_else(|| {
            MobileError::ledger(format!("unknown command category: {}", raw.category))
        })?;

        let status = CommandStatus::from_str(&raw.status).ok_or_else(|| {
            MobileError::ledger(format!("unknown command status: {}", raw.status))
        })?;

        Ok(CommandEntry {
            id: raw.id,
            category,
            command_type: raw.command_type,
            ordering_key: raw.ordering_key,
            status,
            payload_json,
            created_at_ms: raw.created_at_ms as u64,
            updated_at_ms: raw.updated_at_ms as u64,
            attempt_count: raw.attempt_count as u32,
            failure_reason: raw.failure_reason,
        })
    }
}

/// Intermediate row type before decryption.
struct RawRow {
    id: String,
    category: String,
    command_type: String,
    ordering_key: String,
    status: String,
    payload_blob: Vec<u8>,
    created_at_ms: i64,
    updated_at_ms: i64,
    attempt_count: i32,
    failure_reason: Option<String>,
}

fn row_mapper(row: &rusqlite::Row) -> rusqlite::Result<RawRow> {
    Ok(RawRow {
        id: row.get(0)?,
        category: row.get(1)?,
        command_type: row.get(2)?,
        ordering_key: row.get(3)?,
        status: row.get(4)?,
        payload_blob: row.get(5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
        attempt_count: row.get(8)?,
        failure_reason: row.get(9)?,
    })
}

/// Extension trait to convert `Option` out of rusqlite queries.
trait OptionalExt<T> {
    fn optional(self) -> rusqlite::Result<Option<T>>;
}

impl<T> OptionalExt<T> for rusqlite::Result<T> {
    fn optional(self) -> rusqlite::Result<Option<T>> {
        match self {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
}

fn derive_cipher(secret: &[u8]) -> MobileResult<Aes256Gcm> {
    let hk = Hkdf::<Sha256>::new(Some(b"peers-touch-command-ledger"), secret);
    let mut key_bytes = [0u8; 32];
    hk.expand(b"command-ledger-aes256gcm", &mut key_bytes)
        .map_err(|e| MobileError::ledger(format!("HKDF expand failed: {e}")))?;

    Ok(Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| MobileError::ledger(format!("AES key init failed: {e}")))?)
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
