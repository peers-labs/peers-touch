use prost::Message;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::{ReliabilityKeyVault, SecureStorage};
use crate::runtime::command_ledger::{LedgerCapacityExhaustionCause, LedgerCapacityStatus};
use crate::runtime::reliability::{
    CanonicalReliabilityRoot, DraftDisposition, LegacyQuarantine, LegacyQuarantineAction,
    LegacyQuarantineActionResult, LegacyQuarantineState, ReliabilityReset, ReliabilityRuntime,
    ReliabilityRuntimeStatus, ReliabilityScopeCloseResult,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityActivateInput {
    pub station_peer_id: String,
    pub actor_ptid: String,
    pub runtime_generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityRebindInput {
    pub station_peer_id: String,
    pub actor_ptid: String,
    pub runtime_generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityCloseInput {
    pub draft_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDispositionInput {
    pub action: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityResetInput {
    pub confirmation: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityCommandInput {
    pub station_peer_id: String,
    pub actor_ptid: String,
    pub command_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityCheckpointInput {
    pub station_peer_id: String,
    pub actor_ptid: String,
    pub command_id: String,
    pub payload_sha256: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityCheckpointProjection {
    pub command_id: String,
    pub payload_sha256: Vec<u8>,
    pub authoritative_lookup_bytes: Vec<u8>,
    pub created_at_ms: i64,
}

#[cfg(feature = "acceptance-harness")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityAcceptanceFaultInput {
    pub mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDispositionProjection {
    pub recovery_state: Option<&'static str>,
    pub archived_legacy_files: u64,
    pub records_absent: bool,
    pub paths_absent: bool,
    pub keys_absent: bool,
    pub secure_physical_deletion_proven: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityCommandCapacityProjection {
    pub record_count: u64,
    pub record_limit: u64,
    pub byte_usage: u64,
    pub byte_limit: u64,
    pub exhaustion_causes: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityRuntimeStatusProjection {
    #[serde(flatten)]
    pub runtime: ReliabilityRuntimeStatus,
    pub command_capacity: ReliabilityCommandCapacityProjection,
}

#[tauri::command]
pub fn reliability_activate<R: Runtime>(
    app: AppHandle<R>,
    storage: State<'_, SecureStorage>,
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityActivateInput,
) -> MobileResult<ReliabilityRuntimeStatus> {
    let app_data_root = app.path().app_data_dir().map_err(|error| {
        MobileError::reliability(format!("resolve Mobile app-data directory: {error}"))
    })?;
    runtime
        .activate(
            &app_data_root,
            &ReliabilityKeyVault::new(&storage),
            input.station_peer_id,
            input.actor_ptid,
            input.runtime_generation,
            now_unix_ms()?,
        )
        .map_err(map_reliability_error)
}

#[tauri::command]
pub fn reliability_status(
    runtime: State<'_, ReliabilityRuntime>,
) -> MobileResult<ReliabilityRuntimeStatusProjection> {
    let status = runtime.status().map_err(map_reliability_error)?;
    let capacity = reliability_command_capacity(&runtime, &status)?;
    Ok(ReliabilityRuntimeStatusProjection {
        runtime: status,
        command_capacity: capacity.into(),
    })
}

#[tauri::command]
pub fn reliability_rebind_generation(
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityRebindInput,
) -> MobileResult<ReliabilityRuntimeStatus> {
    runtime
        .rebind_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.runtime_generation,
        )
        .map_err(map_reliability_error)
}

#[tauri::command]
pub fn reliability_suspend(
    runtime: State<'_, ReliabilityRuntime>,
) -> MobileResult<ReliabilityRuntimeStatus> {
    runtime.suspend_scope().map_err(map_reliability_error)
}

#[tauri::command]
pub fn reliability_prepare_scope_exit(
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityRebindInput,
) -> MobileResult<ReliabilityRuntimeStatus> {
    runtime
        .prepare_scope_exit(
            &input.station_peer_id,
            &input.actor_ptid,
            input.runtime_generation,
        )
        .map_err(map_reliability_error)
}

#[tauri::command]
pub fn reliability_open_admission(
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityRebindInput,
) -> MobileResult<ReliabilityRuntimeStatus> {
    runtime
        .open_admission(
            &input.station_peer_id,
            &input.actor_ptid,
            input.runtime_generation,
        )
        .map_err(map_reliability_error)
}

#[tauri::command]
pub fn reliability_close_scope(
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityCloseInput,
) -> MobileResult<ReliabilityScopeCloseResult> {
    let disposition = match input.draft_disposition.as_str() {
        "retain" => DraftDisposition::Retain,
        "discard" => DraftDisposition::Discard,
        _ => {
            return Err(MobileError::invalid_input(
                "draftDisposition must be retain or discard",
            ))
        }
    };
    runtime
        .close_scope(disposition)
        .map_err(map_reliability_error)
}

#[tauri::command]
pub fn reliability_apply_legacy_disposition<R: Runtime>(
    app: AppHandle<R>,
    input: LegacyDispositionInput,
) -> MobileResult<LegacyDispositionProjection> {
    let root = reliability_root(&app)?;
    let action = match input.action.as_str() {
        "retain" => LegacyQuarantineAction::Retain,
        "discard-legacy" => LegacyQuarantineAction::DiscardLegacy,
        _ => {
            return Err(MobileError::invalid_input(
                "legacy action must be retain or discard-legacy",
            ))
        }
    };
    let result = LegacyQuarantine::apply(&root, action).map_err(map_reliability_error)?;
    Ok(match result {
        LegacyQuarantineActionResult::Retained(state) => {
            let (recovery_state, archived_legacy_files) = legacy_projection(state);
            LegacyDispositionProjection {
                recovery_state,
                archived_legacy_files,
                records_absent: false,
                paths_absent: false,
                keys_absent: false,
                secure_physical_deletion_proven: false,
            }
        }
        LegacyQuarantineActionResult::Discarded(cleanup) => LegacyDispositionProjection {
            recovery_state: None,
            archived_legacy_files: 0,
            records_absent: cleanup.records_absent,
            paths_absent: cleanup.paths_absent,
            keys_absent: cleanup.keys_absent,
            secure_physical_deletion_proven: cleanup.secure_physical_deletion_proven,
        },
    })
}

#[tauri::command]
pub fn reliability_reset_all<R: Runtime>(
    app: AppHandle<R>,
    storage: State<'_, SecureStorage>,
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityResetInput,
) -> MobileResult<crate::runtime::reliability::LogicalCleanupResult> {
    if input.confirmation != "reset-all-local-reliability-data" {
        return Err(MobileError::invalid_input(
            "whole-app reliability reset requires explicit confirmation",
        ));
    }
    ReliabilityReset::reset_all(
        &reliability_root(&app)?,
        &ReliabilityKeyVault::new(&storage),
        runtime.inner(),
    )
    .map_err(map_reliability_error)
}

#[tauri::command]
pub fn reliability_list_commands(
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityRebindInput,
) -> MobileResult<Vec<Vec<u8>>> {
    let active = runtime
        .active_for_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.runtime_generation,
        )
        .map_err(map_reliability_error)?;
    active
        .ledger
        .list()
        .map(|commands| {
            commands
                .into_iter()
                .map(|command| command.encode_to_vec())
                .collect()
        })
        .map_err(map_ledger_error)
}

#[tauri::command]
pub fn reliability_list_projection_checkpoints(
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityRebindInput,
) -> MobileResult<Vec<ReliabilityCheckpointProjection>> {
    let active = runtime
        .active_for_generation(
            &input.station_peer_id,
            &input.actor_ptid,
            input.runtime_generation,
        )
        .map_err(map_reliability_error)?;
    active
        .ledger
        .list_projection_checkpoints()
        .map(|checkpoints| {
            checkpoints
                .into_iter()
                .map(|checkpoint| ReliabilityCheckpointProjection {
                    command_id: checkpoint.command_id,
                    payload_sha256: checkpoint.payload_sha256,
                    authoritative_lookup_bytes: checkpoint.exact_lookup_bytes,
                    created_at_ms: checkpoint.created_at_ms,
                })
                .collect()
        })
        .map_err(map_ledger_error)
}

#[tauri::command]
pub fn reliability_cancel_command(
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityCommandInput,
) -> MobileResult<()> {
    let active = runtime
        .active_for_scope(&input.station_peer_id, &input.actor_ptid)
        .map_err(map_reliability_error)?;
    let command = active
        .ledger
        .get(&input.command_id)
        .map_err(map_ledger_error)?
        .ok_or_else(|| MobileError::ledger("command does not exist"))?;
    let state = command
        .state
        .try_into()
        .map_err(|_| MobileError::ledger("command has an unknown generated state"))?;
    active
        .ledger
        .cancel_before_dispatch(
            &input.command_id,
            state,
            active.runtime_generation(),
            now_unix_ms()?,
        )
        .and_then(|_| active.ledger.purge_cancelled(&input.command_id))
        .map_err(map_ledger_error)
}

#[tauri::command]
pub fn reliability_acknowledge_terminal_failure(
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityCommandInput,
) -> MobileResult<()> {
    let active = runtime
        .active_for_scope(&input.station_peer_id, &input.actor_ptid)
        .map_err(map_reliability_error)?;
    active
        .ledger
        .acknowledge_terminal_failure(
            &input.command_id,
            active.runtime_generation(),
            now_unix_ms()?,
        )
        .map_err(map_ledger_error)
}

#[tauri::command]
pub fn reliability_acknowledge_projection(
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityCheckpointInput,
) -> MobileResult<()> {
    #[cfg(feature = "acceptance-harness")]
    if crate::runtime::reliability::acceptance::fail_checkpoint_acknowledgement()
        .map_err(map_reliability_error)?
    {
        return Err(MobileError::reliability(
            "Acceptance fault: projection checkpoint acknowledgement unavailable",
        ));
    }
    let active = runtime
        .active_for_scope(&input.station_peer_id, &input.actor_ptid)
        .map_err(map_reliability_error)?;
    active
        .ledger
        .acknowledge_projection_checkpoint(&input.command_id, &input.payload_sha256)
        .map_err(map_ledger_error)
}

#[tauri::command]
pub fn reliability_discard_unresolved(
    runtime: State<'_, ReliabilityRuntime>,
    input: ReliabilityCommandInput,
) -> MobileResult<()> {
    let active = runtime
        .active_for_scope(&input.station_peer_id, &input.actor_ptid)
        .map_err(map_reliability_error)?;
    active
        .ledger
        .discard_unresolved_tracking(
            &input.command_id,
            active.runtime_generation(),
            now_unix_ms()?,
        )
        .map_err(map_ledger_error)
}

#[cfg(feature = "acceptance-harness")]
#[tauri::command]
pub fn reliability_acceptance_configure_fault(
    input: ReliabilityAcceptanceFaultInput,
) -> MobileResult<crate::runtime::reliability::acceptance::ReliabilityAcceptanceFaultProjection> {
    crate::runtime::reliability::acceptance::configure(&input.mode).map_err(map_reliability_error)
}

fn reliability_root<R: Runtime>(app: &AppHandle<R>) -> MobileResult<CanonicalReliabilityRoot> {
    let app_data_root = app.path().app_data_dir().map_err(|error| {
        MobileError::reliability(format!("resolve Mobile app-data directory: {error}"))
    })?;
    CanonicalReliabilityRoot::from_trusted_app_data(&app_data_root).map_err(map_reliability_error)
}

fn legacy_projection(state: LegacyQuarantineState) -> (Option<&'static str>, u64) {
    match state {
        LegacyQuarantineState::Clean => (None, 0),
        LegacyQuarantineState::DispositionRequired { archived_files, .. } => {
            (Some("legacy-disposition-required"), archived_files as u64)
        }
    }
}

fn reliability_command_capacity(
    runtime: &ReliabilityRuntime,
    status: &ReliabilityRuntimeStatus,
) -> MobileResult<LedgerCapacityStatus> {
    if !status.active {
        return Ok(LedgerCapacityStatus::default());
    }
    let station_peer_id = status.station_peer_id.as_deref().ok_or_else(|| {
        MobileError::reliability("active reliability status is missing stationPeerId")
    })?;
    let actor_ptid = status.actor_ptid.as_deref().ok_or_else(|| {
        MobileError::reliability("active reliability status is missing actorPtid")
    })?;
    runtime
        .active_for_generation(station_peer_id, actor_ptid, status.runtime_generation)
        .map_err(map_reliability_error)?
        .ledger
        .capacity_status()
        .map_err(map_ledger_error)
}

impl From<LedgerCapacityStatus> for ReliabilityCommandCapacityProjection {
    fn from(status: LedgerCapacityStatus) -> Self {
        Self {
            record_count: status.record_count,
            record_limit: status.record_limit,
            byte_usage: status.byte_usage,
            byte_limit: status.byte_limit,
            exhaustion_causes: status
                .exhaustion_causes
                .into_iter()
                .map(|cause| match cause {
                    LedgerCapacityExhaustionCause::RecordCount => "record-count",
                    LedgerCapacityExhaustionCause::ByteCapacity => "byte-capacity",
                })
                .collect(),
        }
    }
}

pub(crate) fn map_ledger_error(error: crate::runtime::command_ledger::LedgerError) -> MobileError {
    MobileError::ledger(error.to_string())
}

pub(crate) fn map_reliability_error(
    error: crate::runtime::reliability::ReliabilityError,
) -> MobileError {
    MobileError::reliability(error.to_string())
}

pub(crate) fn now_unix_ms() -> MobileResult<i64> {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| MobileError::reliability(format!("read current time: {error}")))?;
    i64::try_from(elapsed.as_millis())
        .map_err(|_| MobileError::reliability("current time exceeds i64 milliseconds"))
}
