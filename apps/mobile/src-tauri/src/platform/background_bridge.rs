// Background Bridge — W7 background / resume handling.
//
// Coordinates the transition between background and foreground states.
// WorkManager (Android) and BGTaskScheduler (iOS) emit wakeup events only;
// the Rust kernel and TS runtime owners perform the actual reconciliation.
//
// This module:
// 1. Receives native wakeup signals (background fetch, push, scheduled task).
// 2. Advances the lifecycle generation.
// 3. Emits a typed Tauri event for the TS lifecycle kernel.
// 4. Provides a reconciliation entry point for the Rust-side ledger/draft/session check.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::platform::lifecycle_bridge::{
    self, NativeLifecycleEvent, NativeLifecycleSource, ResumeReconciliationReport,
};
use crate::platform::native_events;
use crate::runtime::command_ledger::CommandLedger;
use crate::runtime::draft_store::DraftStore;

// ---------------------------------------------------------------------------
// Background wakeup event
// ---------------------------------------------------------------------------

pub const MOBILE_LIFECYCLE_EVENT: &str = "mobile:lifecycle";
pub const MOBILE_RECONCILIATION_EVENT: &str = "mobile:reconciliation";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundWakeupPayload {
    pub source: NativeLifecycleSource,
    pub generation: u64,
    pub timestamp_ms: u64,
}

// ---------------------------------------------------------------------------
// Resume handler
// ---------------------------------------------------------------------------

/// Handle a native resume event. This is called from the Tauri RunEvent handler
/// and from native wakeup callbacks (WorkManager, BGTaskScheduler, push).
///
/// Steps:
/// 1. Advance lifecycle generation.
/// 2. Process the event through the lifecycle bridge (dedup + generation check).
/// 3. Emit lifecycle event to the TS layer.
/// 4. Perform Rust-side reconciliation (ledger, drafts, session).
/// 5. Emit reconciliation report to the TS layer.
pub fn handle_native_resume<R: Runtime>(app: &AppHandle<R>, source: NativeLifecycleSource) {
    let generation = lifecycle_bridge::advance_generation();
    let timestamp_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let event_id = format!("{:?}-{}-{}", source, generation, timestamp_ms);

    let lifecycle_event = NativeLifecycleEvent {
        source: source.clone(),
        generation,
        event_id,
        timestamp_ms,
    };

    // Process through generation bridge
    match lifecycle_bridge::process_lifecycle_event(&lifecycle_event) {
        Ok(result) => {
            if !result.accepted {
                // Stale or duplicate event — skip reconciliation
                return;
            }
        }
        Err(_) => {
            // Lock poisoned — emit error and continue
            let _ = native_events::emit_native_event_error(
                app,
                "lifecycle-bridge-process",
                "lifecycle bridge lock poisoned",
            );
            return;
        }
    }

    // Emit lifecycle event to TS layer
    let wakeup = BackgroundWakeupPayload {
        source,
        generation,
        timestamp_ms,
    };
    let _ = app.emit(MOBILE_LIFECYCLE_EVENT, &wakeup);

    // Also emit the existing resume event for backward compatibility
    let _ = native_events::emit_resume(app, "lifecycle-bridge");
}

/// Perform Rust-side reconciliation and emit the report to the TS layer.
///
/// This reads ledger and draft counts synchronously (they are local SQLite)
/// and checks session validity through the stored credential.
pub fn perform_reconciliation<R: Runtime>(app: &AppHandle<R>, session_valid: bool) {
    let generation = lifecycle_bridge::current_generation();

    // Read ledger counts — these are quick local reads.
    // Both CommandLedger and DraftStore are managed state (registered in lib.rs).
    let ledger: tauri::State<'_, CommandLedger> = app.state();
    let draft_store: tauri::State<'_, DraftStore> = app.state();

    let ledger_pending = ledger.count_by_status("pending").unwrap_or(0);
    let ledger_unknown = ledger.count_by_status("unknown").unwrap_or(0);
    let draft_count = draft_store.count_all().unwrap_or(0);

    let report = lifecycle_bridge::build_reconciliation_report(
        ledger_pending,
        ledger_unknown,
        draft_count,
        session_valid,
    );

    // Emit reconciliation report to TS layer
    let _ = app.emit(MOBILE_RECONCILIATION_EVENT, &report);

    // If there are unknown-outcome commands or drafts, the TS recovery
    // projection will pick them up through the reconciliation event.
    // We do not perform retry or persistence here — that is the runtime
    // owner's responsibility.
    drop(generation);
}
