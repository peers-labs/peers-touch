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

use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::error::{MobileError, MobileResult};
use crate::platform::lifecycle_bridge::{
    self, LifecycleBridgeResult, NativeLifecycleEvent, NativeLifecycleSignal,
    NativeLifecycleSource, NativeLifecycleState, ResumeReconciliationReport,
};
use crate::platform::native_events;
use crate::runtime::command_ledger::CommandLedger;
use crate::runtime::draft_store::DraftStore;

// ---------------------------------------------------------------------------
// Background wakeup event
// ---------------------------------------------------------------------------

pub const MOBILE_LIFECYCLE_EVENT: &str = "mobile:lifecycle";
pub const MOBILE_RECONCILIATION_EVENT: &str = "mobile:reconciliation";

// ---------------------------------------------------------------------------
// Native lifecycle and wakeup handlers
// ---------------------------------------------------------------------------

/// Accept a platform foreground/background callback, fence it in Rust, and
/// emit the canonical lifecycle event only when the callback is current.
pub fn ingest_native_lifecycle_signal<R: Runtime>(
    app: &AppHandle<R>,
    signal: NativeLifecycleSignal,
) -> MobileResult<LifecycleBridgeResult> {
    let acceptance = lifecycle_bridge::process_native_signal(&signal)?;
    if let Some(event) = acceptance.event {
        emit_lifecycle_event(app, &event)?;
    }
    Ok(acceptance.result)
}

/// Handle a native wakeup that is not itself an app foreground transition.
///
/// Scheduled-work semantics remain intentionally outside W7-B. This entry
/// point only emits a typed wakeup in the current lifecycle generation.
pub fn handle_native_wakeup<R: Runtime>(app: &AppHandle<R>, source: NativeLifecycleSource) {
    if let Err(error) = try_handle_native_wakeup(app, source) {
        log::error!("background_bridge: native wakeup failed: {error}");
        if let Err(emit_error) = native_events::emit_native_event_error(
            app,
            "lifecycle-bridge-wakeup",
            &error.to_string(),
        ) {
            log::error!("background_bridge: failed to emit native wakeup error: {emit_error}");
        }
    }
}

fn try_handle_native_wakeup<R: Runtime>(
    app: &AppHandle<R>,
    source: NativeLifecycleSource,
) -> MobileResult<()> {
    let generation = lifecycle_bridge::current_generation();
    let timestamp_ms = current_time_ms()?;

    let event_id = format!("{:?}-{}-{}", source, generation, timestamp_ms);

    let lifecycle_event = NativeLifecycleEvent {
        source,
        state: NativeLifecycleState::Wakeup,
        generation,
        event_id,
        timestamp_ms,
    };

    let result = lifecycle_bridge::process_lifecycle_event(&lifecycle_event)?;
    if !result.accepted {
        return Ok(());
    }

    emit_lifecycle_event(app, &lifecycle_event)
}

fn emit_lifecycle_event<R: Runtime>(
    app: &AppHandle<R>,
    event: &NativeLifecycleEvent,
) -> MobileResult<()> {
    app.emit(MOBILE_LIFECYCLE_EVENT, event)
        .map_err(|error| MobileError::lifecycle(format!("failed to emit lifecycle event: {error}")))
}

/// Perform Rust-side reconciliation and emit the report to the TS layer.
///
/// This reads ledger and draft counts synchronously (they are local SQLite)
/// and checks session validity through the stored credential.
pub fn perform_reconciliation<R: Runtime>(
    app: &AppHandle<R>,
    session_valid: bool,
) -> MobileResult<ResumeReconciliationReport> {
    let ledger: tauri::State<'_, CommandLedger> = app.state();
    let draft_store: tauri::State<'_, DraftStore> = app.state();

    let counts = read_reconciliation_counts(
        || ledger.count_by_status("pending"),
        || ledger.count_by_status("unknown"),
        || draft_store.count_all(),
    )?;

    let report = lifecycle_bridge::build_reconciliation_report(
        counts.ledger_pending,
        counts.ledger_unknown,
        counts.drafts,
        session_valid,
    );

    app.emit(MOBILE_RECONCILIATION_EVENT, &report)
        .map_err(|error| {
            MobileError::lifecycle(format!("failed to emit reconciliation report: {error}"))
        })?;

    Ok(report)
}

#[derive(Debug, PartialEq, Eq)]
struct ReconciliationCounts {
    ledger_pending: u64,
    ledger_unknown: u64,
    drafts: u64,
}

fn read_reconciliation_counts<Pending, Unknown, Drafts>(
    read_pending: Pending,
    read_unknown: Unknown,
    read_drafts: Drafts,
) -> MobileResult<ReconciliationCounts>
where
    Pending: FnOnce() -> MobileResult<u64>,
    Unknown: FnOnce() -> MobileResult<u64>,
    Drafts: FnOnce() -> MobileResult<u64>,
{
    Ok(ReconciliationCounts {
        ledger_pending: read_pending()?,
        ledger_unknown: read_unknown()?,
        drafts: read_drafts()?,
    })
}

fn current_time_ms() -> MobileResult<u64> {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| {
            MobileError::lifecycle(format!("failed to read lifecycle timestamp: {error}"))
        })?;
    u64::try_from(elapsed.as_millis())
        .map_err(|_| MobileError::lifecycle("lifecycle timestamp exceeds u64"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconciliation_counts_preserve_readback_values() {
        let counts = read_reconciliation_counts(|| Ok(2), || Ok(3), || Ok(5))
            .expect("reconciliation counts");

        assert_eq!(
            counts,
            ReconciliationCounts {
                ledger_pending: 2,
                ledger_unknown: 3,
                drafts: 5,
            }
        );
    }

    #[test]
    fn reconciliation_counts_propagate_ledger_failure() {
        let error = read_reconciliation_counts(
            || Err(MobileError::ledger("pending read failed")),
            || Ok(0),
            || Ok(0),
        )
        .expect_err("ledger failure");

        assert_eq!(error.code, "MOBILE_COMMAND_LEDGER");
        assert_eq!(error.message, "pending read failed");
    }

    #[test]
    fn reconciliation_counts_propagate_draft_failure() {
        let error = read_reconciliation_counts(
            || Ok(0),
            || Ok(0),
            || Err(MobileError::draft("draft read failed")),
        )
        .expect_err("draft failure");

        assert_eq!(error.code, "MOBILE_DRAFT_STORE");
        assert_eq!(error.message, "draft read failed");
    }
}
