// Tauri commands for the command ledger.
//
// These commands are the IPC bridge between the TypeScript
// `commandRuntime` and the Rust `CommandLedger`.

use serde::Deserialize;
use tauri::State;

use crate::error::{MobileError, MobileResult};
use crate::runtime::command_ledger::entry::{
    CommandCategory, CommandProjection, CommandStatus, TypedCommandEnvelope,
};
use crate::runtime::command_ledger::CommandLedger;

/// Input for `ledger_initialize`.
#[derive(Debug, Deserialize)]
pub struct LedgerInitInput {
    pub db_dir: String,
    pub encryption_secret_b64: String,
}

/// Input for `ledger_admit`.
#[derive(Debug, Deserialize)]
pub struct LedgerAdmitInput {
    pub command_type: String,
    pub category: String,
    pub ordering_key: String,
    pub payload_json: String,
    pub idempotency_key: Option<String>,
}

/// Input for `ledger_update_status`.
#[derive(Debug, Deserialize)]
pub struct LedgerUpdateStatusInput {
    pub id: String,
    pub status: String,
    pub failure_reason: Option<String>,
}

/// Input for `ledger_readback`.
#[derive(Debug, Deserialize)]
pub struct LedgerReadbackInput {
    pub ordering_key: String,
}

/// Input for `ledger_readback_by_status`.
#[derive(Debug, Deserialize)]
pub struct LedgerReadbackByStatusInput {
    pub status: String,
}

/// Admit result returned to TypeScript.
#[derive(Debug, serde::Serialize)]
pub struct LedgerAdmitResult {
    pub command_id: String,
}

#[tauri::command]
pub async fn ledger_initialize(
    input: LedgerInitInput,
    ledger: State<'_, CommandLedger>,
) -> MobileResult<()> {
    let secret = base64::engine::general_purpose::STANDARD
        .decode(&input.encryption_secret_b64)
        .map_err(|e| MobileError::ledger(format!("invalid base64 secret: {e}")))?;

    let db_dir = std::path::PathBuf::from(&input.db_dir);

    ledger.initialize(&db_dir, &secret)
}

use base64::Engine;

#[tauri::command]
pub async fn ledger_admit(
    input: LedgerAdmitInput,
    ledger: State<'_, CommandLedger>,
) -> MobileResult<LedgerAdmitResult> {
    let category = CommandCategory::from_str(&input.category).ok_or_else(|| {
        MobileError::invalid_input(format!("unknown command category: {}", input.category))
    })?;

    let envelope = TypedCommandEnvelope {
        command_type: input.command_type,
        category,
        ordering_key: input.ordering_key,
        payload_json: input.payload_json,
        idempotency_key: input.idempotency_key,
    };

    let command_id = ledger.admit(envelope)?;

    Ok(LedgerAdmitResult { command_id })
}

#[tauri::command]
pub async fn ledger_update_status(
    input: LedgerUpdateStatusInput,
    ledger: State<'_, CommandLedger>,
) -> MobileResult<()> {
    let status = CommandStatus::from_str(&input.status).ok_or_else(|| {
        MobileError::invalid_input(format!("unknown command status: {}", input.status))
    })?;

    match status {
        CommandStatus::Committed => ledger.mark_committed(&input.id),
        CommandStatus::Failed => {
            let reason = input.failure_reason.as_deref().unwrap_or("unknown failure");
            ledger.mark_failed(&input.id, reason)
        }
        _ => Err(MobileError::invalid_input(format!(
            "cannot manually set status to {}",
            input.status,
        ))),
    }
}

#[tauri::command]
pub async fn ledger_readback(
    input: LedgerReadbackInput,
    ledger: State<'_, CommandLedger>,
) -> MobileResult<Vec<CommandProjection>> {
    ledger.readback(&input.ordering_key)
}

#[tauri::command]
pub async fn ledger_readback_by_status(
    input: LedgerReadbackByStatusInput,
    ledger: State<'_, CommandLedger>,
) -> MobileResult<Vec<CommandProjection>> {
    let status = CommandStatus::from_str(&input.status).ok_or_else(|| {
        MobileError::invalid_input(format!("unknown command status: {}", input.status))
    })?;

    ledger.readback_by_status(status)
}

#[tauri::command]
pub async fn ledger_purge_committed(ledger: State<'_, CommandLedger>) -> MobileResult<usize> {
    ledger.purge_committed()
}

#[tauri::command]
pub async fn ledger_shutdown(ledger: State<'_, CommandLedger>) -> MobileResult<()> {
    ledger.shutdown()
}
