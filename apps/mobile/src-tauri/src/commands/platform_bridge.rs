// W7 Tauri commands for lifecycle bridge, permission, and network.

use serde::Deserialize;
use tauri::command;

use crate::error::MobileResult;
use crate::platform::lifecycle_bridge::{
    self, LifecycleBridgeResult, NativeLifecycleEvent, ResumeReconciliationReport,
};
use crate::platform::network_bridge::{self, NetworkState, NetworkType};
use crate::platform::permission_bridge::{
    self, PermissionCheckResult, PermissionKind, PermissionRequestResult,
};

// ---------------------------------------------------------------------------
// Lifecycle commands
// ---------------------------------------------------------------------------

#[command]
pub fn lifecycle_generation() -> u64 {
    lifecycle_bridge::current_generation()
}

#[command]
pub fn lifecycle_advance_generation() -> u64 {
    lifecycle_bridge::advance_generation()
}

#[command]
pub fn lifecycle_process_event(
    input: NativeLifecycleEvent,
) -> MobileResult<LifecycleBridgeResult> {
    lifecycle_bridge::process_lifecycle_event(&input)
}

#[command]
pub fn lifecycle_reconciliation_report(
    input: ReconciliationReportInput,
) -> ResumeReconciliationReport {
    lifecycle_bridge::build_reconciliation_report(
        input.ledger_pending,
        input.ledger_unknown,
        input.draft_count,
        input.session_valid,
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationReportInput {
    pub ledger_pending: u64,
    pub ledger_unknown: u64,
    pub draft_count: u64,
    pub session_valid: bool,
}

// ---------------------------------------------------------------------------
// Permission commands
// ---------------------------------------------------------------------------

#[command]
pub fn permission_check(kind: PermissionKind) -> MobileResult<PermissionCheckResult> {
    permission_bridge::check_permission(kind)
}

#[command]
pub fn permission_request(kind: PermissionKind) -> MobileResult<PermissionRequestResult> {
    permission_bridge::request_permission(kind)
}

#[command]
pub fn permission_check_all() -> MobileResult<Vec<PermissionCheckResult>> {
    permission_bridge::check_all_permissions()
}

// ---------------------------------------------------------------------------
// Network commands
// ---------------------------------------------------------------------------

#[command]
pub fn network_state() -> NetworkState {
    network_bridge::get_network_state()
}

#[command]
pub fn network_update_state(connected: bool, network_type: NetworkType) {
    network_bridge::update_network_state(connected, network_type);
}

#[command]
pub fn network_is_connected() -> bool {
    network_bridge::is_connected()
}
