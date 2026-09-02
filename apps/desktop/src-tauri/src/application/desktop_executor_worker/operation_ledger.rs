use crate::domain::storage::database::{DatabaseOpenSpec, EncryptionLevel};
use crate::infrastructure::storage;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use crate::model::agent::CapabilityOperation;
use prost::Message;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;

const OPERATION_LEDGER_SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Clone)]
enum LedgerStorage {
    Encrypted(DatabaseOpenSpec),
    PlainTest(PathBuf),
}

#[derive(Debug, Clone, PartialEq)]
pub struct OperationCheckpoint {
    pub station_url: String,
    pub operation: CapabilityOperation,
    pub phase: String,
}

#[derive(Debug, Clone)]
pub struct OperationLedger {
    storage: LedgerStorage,
}

impl OperationLedger {
    pub fn open(actor_ptid: &str, device_id: &str) -> Result<Self, String> {
        if !actor_ptid.starts_with("ptid:") || device_id.trim().is_empty() {
            return Err("capability operation ledger requires actor and device".to_string());
        }
        let app_name = std::env::var("PT_PROFILE")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "desktop".to_string());
        let spec = DatabaseOpenSpec {
            app_name: app_name.clone(),
            domain: "agent-capability-operation".to_string(),
            profile: format!("device-{}", scope_hash(device_id)),
            user_scope: actor_ptid.to_string(),
            encryption_level: EncryptionLevel::L2,
            key_ref: format!(
                "agent-capability-operation/{app_name}/{}/{}",
                scope_hash(actor_ptid),
                scope_hash(device_id)
            ),
            schema_version: OPERATION_LEDGER_SCHEMA_VERSION,
        };
        let ledger = Self {
            storage: LedgerStorage::Encrypted(spec),
        };
        ledger.initialize()?;
        Ok(ledger)
    }

    #[cfg(test)]
    pub fn open_test(path: &Path) -> Result<Self, String> {
        let ledger = Self {
            storage: LedgerStorage::PlainTest(path.to_path_buf()),
        };
        ledger.initialize()?;
        Ok(ledger)
    }

    pub fn load(
        &self,
        operation_id: &str,
        attempt_epoch: u64,
        fencing_token: u64,
    ) -> Result<Option<OperationCheckpoint>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT station_url, operation, phase
                 FROM capability_operation_checkpoints
                 WHERE operation_id = ?1 AND attempt_epoch = ?2 AND fencing_token = ?3",
                params![
                    operation_id,
                    to_sql_u64("attempt_epoch", attempt_epoch)?,
                    to_sql_u64("fencing_token", fencing_token)?,
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("load capability operation checkpoint: {error}"))?
            .map(|(station_url, bytes, phase)| {
                Ok(OperationCheckpoint {
                    station_url,
                    operation: CapabilityOperation::decode(bytes.as_slice()).map_err(|error| {
                        format!("decode capability operation checkpoint: {error}")
                    })?,
                    phase,
                })
            })
            .transpose()
    }

    pub fn store(
        &self,
        station_url: &str,
        operation: &CapabilityOperation,
        phase: &str,
    ) -> Result<(), String> {
        if station_url.trim().is_empty() || phase.trim().is_empty() {
            return Err("operation checkpoint requires Station and phase".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("begin operation checkpoint transaction: {error}"))?;
        let bytes = operation.encode_to_vec();
        if let Some(existing) = load_checkpoint_tx(
            &transaction,
            &operation.operation_id,
            operation.attempt_epoch,
            operation.fencing_token,
        )? {
            if existing.station_url != station_url.trim_end_matches('/') {
                return Err("CAPABILITY_OPERATION_STATION_CONFLICT".to_string());
            }
            transaction
                .execute(
                    "UPDATE capability_operation_checkpoints
                     SET operation = ?1, phase = ?2, updated_at_ms = ?3
                     WHERE operation_id = ?4 AND attempt_epoch = ?5 AND fencing_token = ?6",
                    params![
                        bytes,
                        phase,
                        now_unix_ms(),
                        operation.operation_id,
                        to_sql_u64("attempt_epoch", operation.attempt_epoch)?,
                        to_sql_u64("fencing_token", operation.fencing_token)?,
                    ],
                )
                .map_err(|error| format!("update operation checkpoint: {error}"))?;
        } else {
            transaction
                .execute(
                    "INSERT INTO capability_operation_checkpoints(
                        operation_id, attempt_epoch, fencing_token, station_url,
                        operation, phase, updated_at_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        operation.operation_id,
                        to_sql_u64("attempt_epoch", operation.attempt_epoch)?,
                        to_sql_u64("fencing_token", operation.fencing_token)?,
                        station_url.trim_end_matches('/'),
                        bytes,
                        phase,
                        now_unix_ms(),
                    ],
                )
                .map_err(|error| format!("insert operation checkpoint: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("commit operation checkpoint: {error}"))
    }

    pub fn cursor(&self, station_url: &str, session_id: &str) -> Result<u64, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT last_sequence FROM capability_operation_cursors
                 WHERE station_url = ?1 AND session_id = ?2",
                params![station_url.trim_end_matches('/'), session_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| format!("load capability operation cursor: {error}"))?
            .map(|value| u64::try_from(value).map_err(|_| "negative operation cursor".to_string()))
            .transpose()
            .map(|value| value.unwrap_or_default())
    }

    pub fn advance_cursor(
        &self,
        station_url: &str,
        session_id: &str,
        expected: u64,
        next: u64,
    ) -> Result<(), String> {
        if next <= expected {
            return Err("CAPABILITY_OPERATION_CURSOR_REGRESSION".to_string());
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("begin operation cursor transaction: {error}"))?;
        let current = transaction
            .query_row(
                "SELECT last_sequence FROM capability_operation_cursors
                 WHERE station_url = ?1 AND session_id = ?2",
                params![station_url.trim_end_matches('/'), session_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| format!("load operation cursor transaction: {error}"))?
            .unwrap_or_default();
        if u64::try_from(current).map_err(|_| "negative operation cursor".to_string())? != expected
        {
            return Err("CAPABILITY_OPERATION_CURSOR_CONFLICT".to_string());
        }
        transaction
            .execute(
                "INSERT INTO capability_operation_cursors(station_url, session_id, last_sequence)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(station_url, session_id)
                 DO UPDATE SET last_sequence = excluded.last_sequence",
                params![
                    station_url.trim_end_matches('/'),
                    session_id,
                    to_sql_u64("last_sequence", next)?,
                ],
            )
            .map_err(|error| format!("advance capability operation cursor: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit capability operation cursor: {error}"))
    }

    fn initialize(&self) -> Result<(), String> {
        self.connection()?
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = FULL;
                 CREATE TABLE IF NOT EXISTS capability_operation_checkpoints (
                    operation_id TEXT NOT NULL,
                    attempt_epoch INTEGER NOT NULL,
                    fencing_token INTEGER NOT NULL,
                    station_url TEXT NOT NULL,
                    operation BLOB NOT NULL,
                    phase TEXT NOT NULL,
                    updated_at_ms INTEGER NOT NULL,
                    PRIMARY KEY(operation_id, attempt_epoch, fencing_token)
                 );
                 CREATE TABLE IF NOT EXISTS capability_operation_cursors (
                    station_url TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    last_sequence INTEGER NOT NULL,
                    PRIMARY KEY(station_url, session_id)
                 );",
            )
            .map_err(|error| format!("initialize capability operation ledger: {error}"))
    }

    fn connection(&self) -> Result<Connection, String> {
        match &self.storage {
            LedgerStorage::Encrypted(spec) => {
                storage::open_database(spec, PlatformKeyProvider::shared())
                    .map_err(|error| format!("open encrypted operation ledger: {error}"))
            }
            LedgerStorage::PlainTest(path) => Connection::open(path)
                .map_err(|error| format!("open operation ledger test database: {error}")),
        }
    }
}

fn load_checkpoint_tx(
    transaction: &rusqlite::Transaction<'_>,
    operation_id: &str,
    attempt_epoch: u64,
    fencing_token: u64,
) -> Result<Option<OperationCheckpoint>, String> {
    transaction
        .query_row(
            "SELECT station_url, operation, phase
             FROM capability_operation_checkpoints
             WHERE operation_id = ?1 AND attempt_epoch = ?2 AND fencing_token = ?3",
            params![
                operation_id,
                to_sql_u64("attempt_epoch", attempt_epoch)?,
                to_sql_u64("fencing_token", fencing_token)?,
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("load operation checkpoint transaction: {error}"))?
        .map(|(station_url, bytes, phase)| {
            Ok(OperationCheckpoint {
                station_url,
                operation: CapabilityOperation::decode(bytes.as_slice())
                    .map_err(|error| format!("decode operation checkpoint: {error}"))?,
                phase,
            })
        })
        .transpose()
}

fn scope_hash(value: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn to_sql_u64(name: &str, value: u64) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| format!("{name} exceeds SQLite INTEGER range"))
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::agent::CapabilityOperationStatus;

    #[test]
    fn capability_operation_ledger_persists_cursor_and_checkpoint_across_reopen() {
        let path = std::env::temp_dir().join(format!(
            "peers-operation-ledger-{}.sqlite3",
            ulid::Ulid::new()
        ));
        let ledger = OperationLedger::open_test(&path).expect("open operation ledger");
        let operation = CapabilityOperation {
            operation_id: "operation-1".to_string(),
            attempt_epoch: 1,
            fencing_token: 1,
            status: CapabilityOperationStatus::Running as i32,
            ..Default::default()
        };
        ledger
            .store("http://station", &operation, "running")
            .expect("store checkpoint");
        ledger
            .advance_cursor("http://station", "session-1", 0, 7)
            .expect("advance cursor");

        let reopened = OperationLedger::open_test(&path).expect("reopen operation ledger");
        let checkpoint = reopened
            .load("operation-1", 1, 1)
            .expect("load checkpoint")
            .expect("checkpoint exists");
        assert_eq!(checkpoint.phase, "running");
        assert_eq!(reopened.cursor("http://station", "session-1").unwrap(), 7);
        assert_eq!(
            reopened
                .advance_cursor("http://station", "session-1", 0, 8)
                .unwrap_err(),
            "CAPABILITY_OPERATION_CURSOR_CONFLICT"
        );

        drop(reopened);
        drop(ledger);
        let _ = std::fs::remove_file(path);
    }
}
