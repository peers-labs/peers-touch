// Lifecycle Bridge — W7 native lifecycle generation propagation.
//
// Bridges native OS lifecycle events (background, resume, wakeup) into the
// Rust capability kernel with lifecycle generation tracking. Each native event
// carries a generation counter; stale events (generation < current) are rejected
// to prevent out-of-order state corruption.
//
// Design rules:
// - WorkManager / BGTaskScheduler emit wakeups only.
// - Rust / runtime owners perform reconciliation.
// - No component creates a second retry or persistence owner.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{MobileError, MobileResult};

// ---------------------------------------------------------------------------
// Lifecycle generation counter
// ---------------------------------------------------------------------------

/// Monotonically increasing generation counter for lifecycle events.
/// Each resume increments the generation; events with a stale generation
/// are silently rejected.
static LIFECYCLE_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Record of the last processed event per source, used to detect duplicates.
static LAST_EVENT_ID: Mutex<Option<String>> = Mutex::new(None);

/// Read the current lifecycle generation.
pub fn current_generation() -> u64 {
    LIFECYCLE_GENERATION.load(Ordering::Acquire)
}

/// Increment and return the new lifecycle generation.
/// Called on each native resume event.
pub fn advance_generation() -> u64 {
    LIFECYCLE_GENERATION.fetch_add(1, Ordering::AcqRel) + 1
}

/// Check if a given generation is current (not stale).
pub fn is_current_generation(generation: u64) -> bool {
    generation >= LIFECYCLE_GENERATION.load(Ordering::Acquire)
}

// ---------------------------------------------------------------------------
// Native lifecycle event types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeLifecycleSource {
    /// Tauri RunEvent::Resumed
    TauriResumed,
    /// WorkManager periodic wakeup (Android)
    WorkManagerWakeup,
    /// BGTaskScheduler wakeup (iOS)
    BgTaskWakeup,
    /// Push notification wakeup
    PushWakeup,
    /// Deep-link activation
    DeepLinkActivation,
    /// Network connectivity change
    NetworkChange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLifecycleEvent {
    pub source: NativeLifecycleSource,
    pub generation: u64,
    pub event_id: String,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleBridgeResult {
    pub accepted: bool,
    pub generation: u64,
    pub reason: Option<String>,
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

/// Process a native lifecycle event through the generation bridge.
///
/// Returns `Ok(result)` with `accepted: true` if the event is current,
/// or `accepted: false` with a reason if the event is stale or duplicate.
pub fn process_lifecycle_event(event: &NativeLifecycleEvent) -> MobileResult<LifecycleBridgeResult> {
    let current_gen = current_generation();

    // Reject stale generation
    if event.generation < current_gen {
        return Ok(LifecycleBridgeResult {
            accepted: false,
            generation: current_gen,
            reason: Some(format!(
                "stale generation: event={} current={}",
                event.generation, current_gen
            )),
        });
    }

    // Deduplicate by event_id
    {
        let mut last_id = LAST_EVENT_ID
            .lock()
            .map_err(|_| MobileError::lifecycle("lifecycle event lock poisoned"))?;
        if last_id.as_deref() == Some(&event.event_id) {
            return Ok(LifecycleBridgeResult {
                accepted: false,
                generation: current_gen,
                reason: Some("duplicate event_id".to_string()),
            });
        }
        *last_id = Some(event.event_id.clone());
    }

    Ok(LifecycleBridgeResult {
        accepted: true,
        generation: current_gen,
        reason: None,
    })
}

// ---------------------------------------------------------------------------
// Resume reconciliation coordinator
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeReconciliationReport {
    pub generation: u64,
    pub ledger_pending_count: u64,
    pub ledger_unknown_count: u64,
    pub draft_count: u64,
    pub session_valid: bool,
    pub reconciled_at_ms: u64,
}

/// Perform resume reconciliation: check ledger state, draft state,
/// and session validity. This is the Rust-side owner of reconciliation
/// logic — the TS runtime only reads the result.
pub fn build_reconciliation_report(
    ledger_pending: u64,
    ledger_unknown: u64,
    draft_count: u64,
    session_valid: bool,
) -> ResumeReconciliationReport {
    ResumeReconciliationReport {
        generation: current_generation(),
        ledger_pending_count: ledger_pending,
        ledger_unknown_count: ledger_unknown,
        draft_count,
        session_valid,
        reconciled_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    }
}

// ---------------------------------------------------------------------------
// Reset (for testing / full teardown)
// ---------------------------------------------------------------------------

/// Reset the lifecycle bridge to initial state.
/// Only safe to call during full app teardown or test setup.
pub fn reset_lifecycle_bridge() {
    LIFECYCLE_GENERATION.store(0, Ordering::Release);
    if let Ok(mut last_id) = LAST_EVENT_ID.lock() {
        *last_id = None;
    }
}
