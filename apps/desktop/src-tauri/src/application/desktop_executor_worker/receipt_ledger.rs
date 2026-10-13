use crate::domain::storage::database::{DatabaseOpenSpec, EncryptionLevel};
use crate::infrastructure::storage;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use crate::model::agent::{
    ClientCapabilityReceipt, ClientCapabilityReceiptStatus, ClientCapabilityRequest,
};
use prost::Message;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;

const RECEIPT_LEDGER_SCHEMA_VERSION: i32 = 2;
const RECEIPT_SCHEMA_SQL: &str = "CREATE TABLE IF NOT EXISTS client_capability_receipts (
    tool_call_id TEXT NOT NULL,
    fencing_token INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status INTEGER NOT NULL,
    station_peer_id TEXT NOT NULL,
    envelope BLOB NOT NULL,
    receipt BLOB NOT NULL,
    side_effect_count INTEGER NOT NULL DEFAULT 0,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(tool_call_id, fencing_token),
    UNIQUE(request_id)
);";

#[derive(Debug, Clone)]
enum LedgerStorage {
    Encrypted(DatabaseOpenSpec),
    PlainTest(PathBuf),
}

#[derive(Debug, Clone)]
pub struct ReceiptLedger {
    storage: LedgerStorage,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReceiptRecord {
    pub station_peer_id: String,
    pub envelope: ClientCapabilityRequest,
    pub receipt: ClientCapabilityReceipt,
    pub side_effect_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCallSideEffectCount {
    pub tool_call_id: String,
    pub side_effect_count: u64,
}

impl ReceiptLedger {
    pub fn open(actor_ptid: &str, device_id: &str) -> Result<Self, String> {
        require_scope(actor_ptid, device_id)?;
        let profile = format!("client-capability-{}", scope_hash(device_id));
        let app_name = std::env::var("PT_PROFILE")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "desktop".to_string());
        let spec = DatabaseOpenSpec {
            app_name: app_name.clone(),
            domain: "agent-client-capability".to_string(),
            profile,
            user_scope: actor_ptid.to_string(),
            encryption_level: EncryptionLevel::L2,
            key_ref: format!(
                "agent-client-capability/{app_name}/{}/{}",
                scope_hash(actor_ptid),
                scope_hash(device_id)
            ),
            schema_version: RECEIPT_LEDGER_SCHEMA_VERSION,
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
        tool_call_id: &str,
        fencing_token: u64,
    ) -> Result<Option<ReceiptRecord>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT station_peer_id, envelope, receipt, side_effect_count
                 FROM client_capability_receipts
                 WHERE tool_call_id = ?1 AND fencing_token = ?2",
                params![tool_call_id, to_sql_u64("fencing_token", fencing_token)?],
                |row| {
                    let station_peer_id: String = row.get(0)?;
                    let envelope: Vec<u8> = row.get(1)?;
                    let receipt: Vec<u8> = row.get(2)?;
                    let side_effect_count: i64 = row.get(3)?;
                    Ok((station_peer_id, envelope, receipt, side_effect_count))
                },
            )
            .optional()
            .map_err(|error| format!("load client capability receipt: {error}"))?
            .map(|(station_peer_id, envelope, receipt, side_effect_count)| {
                decode_record(station_peer_id, &envelope, &receipt, side_effect_count)
            })
            .transpose()
    }

    pub fn list(&self) -> Result<Vec<ReceiptRecord>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT station_peer_id, envelope, receipt, side_effect_count
                 FROM client_capability_receipts
                 ORDER BY updated_at_ms ASC",
            )
            .map_err(|error| format!("prepare client capability receipt scan: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|error| format!("scan client capability receipts: {error}"))?;
        rows.map(|row| {
            let (station_peer_id, envelope, receipt, side_effect_count) =
                row.map_err(|error| format!("read client capability receipt row: {error}"))?;
            decode_record(station_peer_id, &envelope, &receipt, side_effect_count)
        })
        .collect()
    }

    pub fn record_side_effect_start(
        &self,
        envelope: &ClientCapabilityRequest,
    ) -> Result<(), String> {
        let envelope_bytes = envelope.encode_to_vec();
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("begin side-effect counter transaction: {error}"))?;
        let existing = load_tx(&transaction, &envelope.tool_call_id, envelope.fencing_token)?
            .ok_or_else(|| "CLIENT_CAPABILITY_PREPARED_RECEIPT_MISSING".to_string())?;
        if existing.envelope.encode_to_vec() != envelope_bytes {
            return Err("CLIENT_CAPABILITY_ENVELOPE_CONFLICT".to_string());
        }
        if existing.receipt.status != ClientCapabilityReceiptStatus::Prepared as i32 {
            return Err("CLIENT_CAPABILITY_SIDE_EFFECT_AFTER_TERMINAL".to_string());
        }
        if !envelope.external_idempotency_key.is_empty() {
            let prior_effect_count: i64 = transaction
                .query_row(
                    "SELECT COALESCE(SUM(side_effect_count), 0)
                     FROM client_capability_receipts
                     WHERE tool_call_id = ?1",
                    params![envelope.tool_call_id],
                    |row| row.get(0),
                )
                .map_err(|error| format!("read ToolCall idempotent side-effect count: {error}"))?;
            if prior_effect_count > 0 {
                transaction
                    .commit()
                    .map_err(|error| format!("commit idempotent side-effect replay: {error}"))?;
                return Ok(());
            }
        }
        let updated = transaction
            .execute(
                "UPDATE client_capability_receipts
                 SET side_effect_count = side_effect_count + 1, updated_at_ms = ?1
                 WHERE tool_call_id = ?2 AND fencing_token = ?3
                   AND side_effect_count = 0",
                params![
                    now_unix_ms(),
                    envelope.tool_call_id,
                    to_sql_u64("fencing_token", envelope.fencing_token)?,
                ],
            )
            .map_err(|error| format!("persist ToolCall side-effect count: {error}"))?;
        if updated != 1 {
            return Err("CLIENT_CAPABILITY_SIDE_EFFECT_ALREADY_STARTED".to_string());
        }
        transaction
            .commit()
            .map_err(|error| format!("commit ToolCall side-effect count: {error}"))
    }

    pub fn side_effect_counts(&self) -> Result<Vec<ToolCallSideEffectCount>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT tool_call_id, SUM(side_effect_count)
                 FROM client_capability_receipts
                 GROUP BY tool_call_id
                 HAVING SUM(side_effect_count) > 0
                 ORDER BY tool_call_id ASC",
            )
            .map_err(|error| format!("prepare ToolCall side-effect count scan: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|error| format!("scan ToolCall side-effect counts: {error}"))?;
        rows.map(|row| {
            let (tool_call_id, side_effect_count) =
                row.map_err(|error| format!("read ToolCall side-effect count row: {error}"))?;
            Ok(ToolCallSideEffectCount {
                tool_call_id,
                side_effect_count: u64::try_from(side_effect_count).map_err(|_| {
                    "ToolCall side-effect count is outside the supported range".to_string()
                })?,
            })
        })
        .collect()
    }

    pub fn prepare(
        &self,
        station_peer_id: &str,
        envelope: &ClientCapabilityRequest,
        receipt: &ClientCapabilityReceipt,
    ) -> Result<ReceiptRecord, String> {
        if station_peer_id.trim().is_empty() {
            return Err("CLIENT_CAPABILITY_STATION_ID_REQUIRED".to_string());
        }
        let envelope_bytes = envelope.encode_to_vec();
        let receipt_bytes = receipt.encode_to_vec();
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("begin PREPARED receipt transaction: {error}"))?;

        if let Some(existing) =
            load_tx(&transaction, &envelope.tool_call_id, envelope.fencing_token)?
        {
            if existing.station_peer_id != station_peer_id
                || existing.envelope.encode_to_vec() != envelope_bytes
            {
                return Err("CLIENT_CAPABILITY_ENVELOPE_CONFLICT".to_string());
            }
            transaction
                .commit()
                .map_err(|error| format!("commit duplicate PREPARED receipt lookup: {error}"))?;
            return Ok(existing);
        }

        transaction
            .execute(
                "INSERT INTO client_capability_receipts(
                    tool_call_id, fencing_token, request_id, payload_hash,
                    status, station_peer_id, envelope, receipt, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    envelope.tool_call_id,
                    to_sql_u64("fencing_token", envelope.fencing_token)?,
                    envelope.request_id,
                    envelope.payload_hash,
                    receipt.status,
                    station_peer_id,
                    envelope_bytes,
                    receipt_bytes,
                    now_unix_ms(),
                ],
            )
            .map_err(|error| format!("persist PREPARED client capability receipt: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit PREPARED client capability receipt: {error}"))?;
        Ok(ReceiptRecord {
            station_peer_id: station_peer_id.to_string(),
            envelope: envelope.clone(),
            receipt: receipt.clone(),
            side_effect_count: 0,
        })
    }

    pub fn commit_terminal(
        &self,
        envelope: &ClientCapabilityRequest,
        receipt: &ClientCapabilityReceipt,
    ) -> Result<ReceiptRecord, String> {
        let envelope_bytes = envelope.encode_to_vec();
        let receipt_bytes = receipt.encode_to_vec();
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("begin terminal receipt transaction: {error}"))?;
        let existing = load_tx(&transaction, &envelope.tool_call_id, envelope.fencing_token)?
            .ok_or_else(|| "CLIENT_CAPABILITY_PREPARED_RECEIPT_MISSING".to_string())?;
        if existing.envelope.encode_to_vec() != envelope_bytes {
            return Err("CLIENT_CAPABILITY_ENVELOPE_CONFLICT".to_string());
        }
        if existing.receipt.status
            != crate::model::agent::ClientCapabilityReceiptStatus::Prepared as i32
        {
            if existing.receipt.encode_to_vec() == receipt_bytes {
                transaction.commit().map_err(|error| {
                    format!("commit duplicate terminal receipt lookup: {error}")
                })?;
                return Ok(existing);
            }
            return Err("CLIENT_CAPABILITY_TERMINAL_RECEIPT_CONFLICT".to_string());
        }
        transaction
            .execute(
                "UPDATE client_capability_receipts
                 SET status = ?1, receipt = ?2, updated_at_ms = ?3
                 WHERE tool_call_id = ?4 AND fencing_token = ?5",
                params![
                    receipt.status,
                    receipt_bytes,
                    now_unix_ms(),
                    envelope.tool_call_id,
                    to_sql_u64("fencing_token", envelope.fencing_token)?,
                ],
            )
            .map_err(|error| format!("persist terminal client capability receipt: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit terminal client capability receipt: {error}"))?;
        Ok(ReceiptRecord {
            station_peer_id: existing.station_peer_id,
            envelope: envelope.clone(),
            receipt: receipt.clone(),
            side_effect_count: existing.side_effect_count,
        })
    }

    fn initialize(&self) -> Result<(), String> {
        let mut connection = self.connection()?;
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;")
            .map_err(|error| format!("configure client capability receipt ledger: {error}"))?;
        if !table_exists(&connection, "client_capability_receipts")? {
            return create_schema(&connection);
        }
        let columns = table_columns(&connection, "client_capability_receipts")?;
        if columns.iter().any(|column| column == "station_peer_id") {
            if columns.iter().any(|column| column == "station_url") {
                return Err("CLIENT_CAPABILITY_SCHEMA_SPLIT_IDENTITY".to_string());
            }
            for required in [
                "tool_call_id",
                "fencing_token",
                "request_id",
                "payload_hash",
                "status",
                "station_peer_id",
                "envelope",
                "receipt",
                "side_effect_count",
                "updated_at_ms",
            ] {
                if !columns.iter().any(|column| column == required) {
                    return Err("CLIENT_CAPABILITY_SCHEMA_UNSUPPORTED".to_string());
                }
            }
            return create_schema(&connection);
        }
        if columns.iter().any(|column| column == "station_url") {
            return migrate_legacy_schema(&mut connection);
        }
        let row_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM client_capability_receipts",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("count unscoped client capability receipts: {error}"))?;
        if row_count > 0 {
            return Err("CAPABILITY_LEDGER_STATION_MIGRATION_UNRESOLVED".to_string());
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("begin empty receipt schema replacement: {error}"))?;
        transaction
            .execute("DROP TABLE client_capability_receipts", [])
            .map_err(|error| format!("drop empty unscoped capability receipt schema: {error}"))?;
        transaction
            .execute_batch(RECEIPT_SCHEMA_SQL)
            .map_err(|error| format!("create scoped capability receipt schema: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit empty receipt schema replacement: {error}"))
    }

    fn connection(&self) -> Result<Connection, String> {
        match &self.storage {
            LedgerStorage::Encrypted(spec) => {
                storage::open_database(spec, PlatformKeyProvider::shared())
                    .map_err(|error| format!("open encrypted client capability ledger: {error}"))
            }
            LedgerStorage::PlainTest(path) => {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|error| {
                        format!("create receipt ledger test directory: {error}")
                    })?;
                }
                Connection::open(path)
                    .map_err(|error| format!("open client capability test ledger: {error}"))
            }
        }
    }
}

fn create_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(RECEIPT_SCHEMA_SQL)
        .map_err(|error| format!("initialize client capability receipt ledger: {error}"))
}

fn migrate_legacy_schema(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("begin client capability receipt schema migration: {error}"))?;
    let row_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM client_capability_receipts",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("count legacy capability receipts: {error}"))?;
    if row_count > 0 {
        return Err("CAPABILITY_LEDGER_STATION_MIGRATION_UNRESOLVED".to_string());
    }
    transaction
        .execute_batch(
            "CREATE TABLE client_capability_receipts_v2 (
                tool_call_id TEXT NOT NULL,
                fencing_token INTEGER NOT NULL,
                request_id TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                status INTEGER NOT NULL,
                station_peer_id TEXT NOT NULL,
                envelope BLOB NOT NULL,
                receipt BLOB NOT NULL,
                side_effect_count INTEGER NOT NULL DEFAULT 0,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY(tool_call_id, fencing_token),
                UNIQUE(request_id)
             );",
        )
        .map_err(|error| format!("create client capability receipt v2 schema: {error}"))?;
    transaction
        .execute_batch(
            "DROP TABLE client_capability_receipts;
             ALTER TABLE client_capability_receipts_v2
                RENAME TO client_capability_receipts;",
        )
        .map_err(|error| format!("replace client capability receipt schema: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("commit client capability receipt schema migration: {error}"))
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
             )",
            params![table],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("inspect client capability receipt table {table}: {error}"))
}

fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("inspect client capability receipt table {table}: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("scan client capability receipt table {table}: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read client capability receipt table {table}: {error}"))
}

fn load_tx(
    transaction: &rusqlite::Transaction<'_>,
    tool_call_id: &str,
    fencing_token: u64,
) -> Result<Option<ReceiptRecord>, String> {
    transaction
        .query_row(
            "SELECT station_peer_id, envelope, receipt, side_effect_count
             FROM client_capability_receipts
             WHERE tool_call_id = ?1 AND fencing_token = ?2",
            params![tool_call_id, to_sql_u64("fencing_token", fencing_token)?],
            |row| {
                let station_peer_id: String = row.get(0)?;
                let envelope: Vec<u8> = row.get(1)?;
                let receipt: Vec<u8> = row.get(2)?;
                let side_effect_count: i64 = row.get(3)?;
                Ok((station_peer_id, envelope, receipt, side_effect_count))
            },
        )
        .optional()
        .map_err(|error| format!("load receipt transaction row: {error}"))?
        .map(|(station_peer_id, envelope, receipt, side_effect_count)| {
            decode_record(station_peer_id, &envelope, &receipt, side_effect_count)
        })
        .transpose()
}

fn decode_record(
    station_peer_id: String,
    envelope: &[u8],
    receipt: &[u8],
    side_effect_count: i64,
) -> Result<ReceiptRecord, String> {
    Ok(ReceiptRecord {
        station_peer_id,
        envelope: ClientCapabilityRequest::decode(envelope)
            .map_err(|error| format!("decode persisted capability envelope: {error}"))?,
        receipt: ClientCapabilityReceipt::decode(receipt)
            .map_err(|error| format!("decode persisted capability receipt: {error}"))?,
        side_effect_count: u64::try_from(side_effect_count)
            .map_err(|_| "negative ToolCall side-effect count".to_string())?,
    })
}

fn require_scope(actor_ptid: &str, device_id: &str) -> Result<(), String> {
    if !actor_ptid.starts_with("ptid:") {
        return Err("client capability ledger requires canonical PTID".to_string());
    }
    if device_id.trim().is_empty() {
        return Err("client capability ledger requires device ID".to_string());
    }
    Ok(())
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

    #[test]
    fn client_capability_receipt_schema_uses_logical_station_identity() {
        let path = std::env::temp_dir().join(format!(
            "peers-capability-receipt-schema-{}.sqlite3",
            ulid::Ulid::new()
        ));
        let ledger = ReceiptLedger::open_test(&path).expect("open receipt ledger");
        let connection = ledger.connection().expect("open ledger connection");
        let columns = table_columns(&connection, "client_capability_receipts");

        assert!(columns.contains(&"station_peer_id".to_string()));
        assert!(!columns.contains(&"station_url".to_string()));

        drop(connection);
        drop(ledger);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn fresh_receipt_schema_has_no_route_migration_dependency() {
        let path = std::env::temp_dir().join(format!(
            "peers-capability-receipt-shared-relay-{}.sqlite3",
            ulid::Ulid::new()
        ));

        let ledger = ReceiptLedger::open_test(&path).unwrap();

        assert!(ledger.list().unwrap().is_empty());
        drop(ledger);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn client_capability_receipt_replay_is_scoped_by_logical_station() {
        let path = std::env::temp_dir().join(format!(
            "peers-capability-receipt-replay-{}.sqlite3",
            ulid::Ulid::new()
        ));
        let ledger = ReceiptLedger::open_test(&path).unwrap();
        let envelope = envelope();
        let receipt = prepared_receipt(&envelope);

        let first = ledger.prepare("station-a", &envelope, &receipt).unwrap();
        let replay = ledger.prepare("station-a", &envelope, &receipt).unwrap();

        assert_eq!(first, replay);
        assert_eq!(replay.station_peer_id, "station-a");
        assert_eq!(
            ledger
                .prepare("station-b", &envelope, &receipt)
                .unwrap_err(),
            "CLIENT_CAPABILITY_ENVELOPE_CONFLICT"
        );

        drop(ledger);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn client_capability_receipt_schema_migrates_empty_legacy_schema() {
        let path = std::env::temp_dir().join(format!(
            "peers-capability-receipt-migration-{}.sqlite3",
            ulid::Ulid::new()
        ));
        create_legacy_schema(&path);

        let ledger = ReceiptLedger::open_test(&path).unwrap();

        assert!(ledger.list().unwrap().is_empty());
        let connection = ledger.connection().unwrap();
        assert!(!table_columns(&connection, "client_capability_receipts")
            .contains(&"station_url".to_string()));
        assert!(table_columns(&connection, "client_capability_receipts")
            .contains(&"station_peer_id".to_string()));

        drop(connection);
        drop(ledger);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn receipt_schema_rejects_origin_only_legacy_identity_atomically() {
        let path = std::env::temp_dir().join(format!(
            "peers-capability-receipt-reassigned-origin-{}.sqlite3",
            ulid::Ulid::new()
        ));
        create_legacy_receipt(&path, "https://reassigned.station.test");

        assert_eq!(
            ReceiptLedger::open_test(&path).unwrap_err(),
            "CAPABILITY_LEDGER_STATION_MIGRATION_UNRESOLVED"
        );
        let connection = Connection::open(&path).unwrap();
        assert!(table_columns(&connection, "client_capability_receipts")
            .contains(&"station_url".to_string()));
        assert!(!table_exists(&connection, "client_capability_receipts_v2").unwrap());

        drop(connection);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn receipt_schema_rejects_shared_relay_legacy_identity_atomically() {
        let path = std::env::temp_dir().join(format!(
            "peers-capability-receipt-ambiguous-{}.sqlite3",
            ulid::Ulid::new()
        ));
        create_legacy_receipt(&path, "https://relay.shared.test");

        assert_eq!(
            ReceiptLedger::open_test(&path).unwrap_err(),
            "CAPABILITY_LEDGER_STATION_MIGRATION_UNRESOLVED"
        );
        let connection = Connection::open(&path).unwrap();
        assert!(table_columns(&connection, "client_capability_receipts")
            .contains(&"station_url".to_string()));
        assert!(!table_exists(&connection, "client_capability_receipts_v2").unwrap());

        drop(connection);
        let _ = std::fs::remove_file(path);
    }

    fn create_legacy_receipt(path: &Path, station_url: &str) {
        let envelope = envelope();
        let receipt = prepared_receipt(&envelope);
        create_legacy_schema(path);
        let connection = Connection::open(path).unwrap();
        connection
            .execute(
                "INSERT INTO client_capability_receipts VALUES(
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
                 )",
                params![
                    envelope.tool_call_id,
                    1_i64,
                    envelope.request_id,
                    envelope.payload_hash,
                    receipt.status,
                    station_url,
                    envelope.encode_to_vec(),
                    receipt.encode_to_vec(),
                    1_i64,
                    1_i64,
                ],
            )
            .unwrap();
    }

    fn create_legacy_schema(path: &Path) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE client_capability_receipts (
                    tool_call_id TEXT NOT NULL,
                    fencing_token INTEGER NOT NULL,
                    request_id TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    status INTEGER NOT NULL,
                    station_url TEXT NOT NULL,
                    envelope BLOB NOT NULL,
                    receipt BLOB NOT NULL,
                    side_effect_count INTEGER NOT NULL DEFAULT 0,
                    updated_at_ms INTEGER NOT NULL,
                    PRIMARY KEY(tool_call_id, fencing_token),
                    UNIQUE(request_id)
                 );",
            )
            .unwrap();
    }

    fn envelope() -> ClientCapabilityRequest {
        ClientCapabilityRequest {
            request_id: "request-1".to_string(),
            tool_call_id: "tool-call-1".to_string(),
            fencing_token: 1,
            payload_hash: "sha256:payload".to_string(),
            ..Default::default()
        }
    }

    fn prepared_receipt(envelope: &ClientCapabilityRequest) -> ClientCapabilityReceipt {
        ClientCapabilityReceipt {
            request_id: envelope.request_id.clone(),
            tool_call_id: envelope.tool_call_id.clone(),
            fencing_token: envelope.fencing_token,
            payload_hash: envelope.payload_hash.clone(),
            status: ClientCapabilityReceiptStatus::Prepared as i32,
            ..Default::default()
        }
    }

    fn table_columns(connection: &Connection, table: &str) -> Vec<String> {
        let mut statement = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("prepare table info");
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("query table columns")
            .map(|column| column.expect("decode table column"))
            .collect()
    }
}
