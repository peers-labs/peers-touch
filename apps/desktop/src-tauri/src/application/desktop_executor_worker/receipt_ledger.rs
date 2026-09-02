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

const RECEIPT_LEDGER_SCHEMA_VERSION: i32 = 1;

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
    pub station_url: String,
    pub envelope: ClientCapabilityRequest,
    pub receipt: ClientCapabilityReceipt,
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
                "SELECT station_url, envelope, receipt
                 FROM client_capability_receipts
                 WHERE tool_call_id = ?1 AND fencing_token = ?2",
                params![tool_call_id, to_sql_u64("fencing_token", fencing_token)?],
                |row| {
                    let station_url: String = row.get(0)?;
                    let envelope: Vec<u8> = row.get(1)?;
                    let receipt: Vec<u8> = row.get(2)?;
                    Ok((station_url, envelope, receipt))
                },
            )
            .optional()
            .map_err(|error| format!("load client capability receipt: {error}"))?
            .map(|(station_url, envelope, receipt)| decode_record(station_url, &envelope, &receipt))
            .transpose()
    }

    pub fn list(&self) -> Result<Vec<ReceiptRecord>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT station_url, envelope, receipt
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
                ))
            })
            .map_err(|error| format!("scan client capability receipts: {error}"))?;
        rows.map(|row| {
            let (station_url, envelope, receipt) =
                row.map_err(|error| format!("read client capability receipt row: {error}"))?;
            decode_record(station_url, &envelope, &receipt)
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
        station_url: &str,
        envelope: &ClientCapabilityRequest,
        receipt: &ClientCapabilityReceipt,
    ) -> Result<ReceiptRecord, String> {
        if station_url.trim().is_empty() {
            return Err("CLIENT_CAPABILITY_STATION_URL_REQUIRED".to_string());
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
            if existing.station_url != station_url.trim_end_matches('/')
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
                    status, station_url, envelope, receipt, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    envelope.tool_call_id,
                    to_sql_u64("fencing_token", envelope.fencing_token)?,
                    envelope.request_id,
                    envelope.payload_hash,
                    receipt.status,
                    station_url.trim_end_matches('/'),
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
            station_url: station_url.trim_end_matches('/').to_string(),
            envelope: envelope.clone(),
            receipt: receipt.clone(),
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
            station_url: existing.station_url,
            envelope: envelope.clone(),
            receipt: receipt.clone(),
        })
    }

    fn initialize(&self) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = FULL;
                 CREATE TABLE IF NOT EXISTS client_capability_receipts (
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
            .map_err(|error| format!("initialize client capability receipt ledger: {error}"))?;
        let has_station_url = {
            let mut statement = connection
                .prepare("PRAGMA table_info(client_capability_receipts)")
                .map_err(|error| format!("inspect client capability receipt ledger: {error}"))?;
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| format!("read client capability receipt columns: {error}"))?;
            let mut found = false;
            for column in columns {
                if column
                    .map_err(|error| format!("decode client capability receipt column: {error}"))?
                    == "station_url"
                {
                    found = true;
                    break;
                }
            }
            found
        };
        if !has_station_url {
            connection
                .execute(
                    "ALTER TABLE client_capability_receipts
                     ADD COLUMN station_url TEXT NOT NULL DEFAULT ''",
                    [],
                )
                .map_err(|error| format!("add receipt Station origin: {error}"))?;
        }
        let has_side_effect_count = {
            let mut statement = connection
                .prepare("PRAGMA table_info(client_capability_receipts)")
                .map_err(|error| format!("inspect client capability receipt ledger: {error}"))?;
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| format!("read client capability receipt columns: {error}"))?;
            let mut found = false;
            for column in columns {
                if column
                    .map_err(|error| format!("decode client capability receipt column: {error}"))?
                    == "side_effect_count"
                {
                    found = true;
                    break;
                }
            }
            found
        };
        if !has_side_effect_count {
            connection
                .execute(
                    "ALTER TABLE client_capability_receipts
                     ADD COLUMN side_effect_count INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .map_err(|error| format!("add ToolCall side-effect counter: {error}"))?;
        }
        Ok(())
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

fn load_tx(
    transaction: &rusqlite::Transaction<'_>,
    tool_call_id: &str,
    fencing_token: u64,
) -> Result<Option<ReceiptRecord>, String> {
    transaction
        .query_row(
            "SELECT station_url, envelope, receipt
             FROM client_capability_receipts
             WHERE tool_call_id = ?1 AND fencing_token = ?2",
            params![tool_call_id, to_sql_u64("fencing_token", fencing_token)?],
            |row| {
                let station_url: String = row.get(0)?;
                let envelope: Vec<u8> = row.get(1)?;
                let receipt: Vec<u8> = row.get(2)?;
                Ok((station_url, envelope, receipt))
            },
        )
        .optional()
        .map_err(|error| format!("load receipt transaction row: {error}"))?
        .map(|(station_url, envelope, receipt)| decode_record(station_url, &envelope, &receipt))
        .transpose()
}

fn decode_record(
    station_url: String,
    envelope: &[u8],
    receipt: &[u8],
) -> Result<ReceiptRecord, String> {
    Ok(ReceiptRecord {
        station_url,
        envelope: ClientCapabilityRequest::decode(envelope)
            .map_err(|error| format!("decode persisted capability envelope: {error}"))?,
        receipt: ClientCapabilityReceipt::decode(receipt)
            .map_err(|error| format!("decode persisted capability receipt: {error}"))?,
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
