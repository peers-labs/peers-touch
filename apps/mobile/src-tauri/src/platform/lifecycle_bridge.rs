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

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use crate::error::{MobileError, MobileResult};

// ---------------------------------------------------------------------------
// Lifecycle generation counter
// ---------------------------------------------------------------------------

/// Monotonically increasing generation counter for lifecycle events.
/// Each resume increments the generation; events with a stale generation
/// are silently rejected.
static LIFECYCLE_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Event identities accepted in the current generation.
///
/// Keeping all identities for the active generation rejects non-consecutive
/// duplicates without retaining identifiers from fenced generations.
static PROCESSED_EVENT_IDS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Last native callback sequence accepted for each platform process.
///
/// Native code does not own lifecycle generations. Its monotonically
/// increasing sequence only lets Rust reject replayed or reordered callbacks
/// before deciding whether a foreground signal advances the generation.
static LAST_NATIVE_SIGNAL_SEQUENCE: LazyLock<Mutex<HashMap<NativeLifecyclePlatform, u64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Read the current lifecycle generation.
pub fn current_generation() -> u64 {
    LIFECYCLE_GENERATION.load(Ordering::Acquire)
}

/// Increment and return the new lifecycle generation.
/// Called on each native resume event.
pub fn advance_generation() -> u64 {
    let mut processed_event_ids = lock_processed_event_ids_after_poison();
    let current = LIFECYCLE_GENERATION.load(Ordering::Acquire);
    let next = current.saturating_add(1);
    if next != current {
        LIFECYCLE_GENERATION.store(next, Ordering::Release);
        processed_event_ids.clear();
    }
    next
}

/// Check if a given generation is exactly current.
pub fn is_current_generation(generation: u64) -> bool {
    generation == LIFECYCLE_GENERATION.load(Ordering::Acquire)
}

// ---------------------------------------------------------------------------
// Native lifecycle event types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeLifecycleSource {
    /// Android Activity visibility callback.
    AndroidActivity,
    /// iOS UIApplication visibility callback.
    IosApplication,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeLifecycleState {
    Foreground,
    Background,
    Wakeup,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeLifecyclePlatform {
    Android,
    Ios,
}

impl NativeLifecyclePlatform {
    fn source(self) -> NativeLifecycleSource {
        match self {
            Self::Android => NativeLifecycleSource::AndroidActivity,
            Self::Ios => NativeLifecycleSource::IosApplication,
        }
    }

    fn wire_name(self) -> &'static str {
        match self {
            Self::Android => "android",
            Self::Ios => "ios",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLifecycleSignal {
    pub platform: NativeLifecyclePlatform,
    pub state: NativeLifecycleState,
    pub sequence: u64,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLifecycleEvent {
    pub source: NativeLifecycleSource,
    pub state: NativeLifecycleState,
    pub generation: u64,
    pub event_id: String,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleBridgeResult {
    pub accepted: bool,
    pub generation: u64,
    pub reason: Option<LifecycleRejectionReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleRejectionReason {
    StaleGeneration,
    FutureGeneration,
    DuplicateEventId,
    StaleNativeSequence,
}

#[derive(Debug)]
pub struct NativeLifecycleAcceptance {
    pub result: LifecycleBridgeResult,
    pub event: Option<NativeLifecycleEvent>,
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

/// Process a native lifecycle event through the generation bridge.
///
/// Returns `Ok(result)` with `accepted: true` if the event is current,
/// or `accepted: false` with a reason if the event is stale or duplicate.
pub fn process_lifecycle_event(
    event: &NativeLifecycleEvent,
) -> MobileResult<LifecycleBridgeResult> {
    if event.event_id.trim().is_empty() {
        return Err(MobileError::invalid_input(
            "lifecycle event_id must not be empty",
        ));
    }

    let mut processed_event_ids = lock_processed_event_ids()?;
    let current_gen = current_generation();

    if event.generation < current_gen {
        return Ok(LifecycleBridgeResult {
            accepted: false,
            generation: current_gen,
            reason: Some(LifecycleRejectionReason::StaleGeneration),
        });
    }

    if event.generation > current_gen {
        return Ok(LifecycleBridgeResult {
            accepted: false,
            generation: current_gen,
            reason: Some(LifecycleRejectionReason::FutureGeneration),
        });
    }

    if !processed_event_ids.insert(event.event_id.clone()) {
        return Ok(LifecycleBridgeResult {
            accepted: false,
            generation: current_gen,
            reason: Some(LifecycleRejectionReason::DuplicateEventId),
        });
    }

    Ok(LifecycleBridgeResult {
        accepted: true,
        generation: current_gen,
        reason: None,
    })
}

/// Convert an OS callback into a generation-fenced canonical lifecycle event.
///
/// Foreground callbacks advance the Rust-owned generation. Background
/// callbacks retain the current generation. Native sequence numbers are scoped
/// to one platform process and are used only to reject callback replay.
pub fn process_native_signal(
    signal: &NativeLifecycleSignal,
) -> MobileResult<NativeLifecycleAcceptance> {
    if signal.sequence == 0 {
        return Err(MobileError::invalid_input(
            "native lifecycle sequence must be greater than zero",
        ));
    }
    if !signal_platform_matches(compiled_native_platform(), signal.platform) {
        return Err(MobileError::invalid_input(format!(
            "native lifecycle platform {} does not match the compiled target",
            signal.platform.wire_name()
        )));
    }

    let mut sequences = LAST_NATIVE_SIGNAL_SEQUENCE
        .lock()
        .map_err(|_| MobileError::lifecycle("native lifecycle sequence lock poisoned"))?;
    if sequences
        .get(&signal.platform)
        .is_some_and(|last_sequence| signal.sequence <= *last_sequence)
    {
        return Ok(NativeLifecycleAcceptance {
            result: LifecycleBridgeResult {
                accepted: false,
                generation: current_generation(),
                reason: Some(LifecycleRejectionReason::StaleNativeSequence),
            },
            event: None,
        });
    }

    let generation = match signal.state {
        NativeLifecycleState::Foreground => advance_generation(),
        NativeLifecycleState::Background | NativeLifecycleState::Wakeup => current_generation(),
    };
    let event = NativeLifecycleEvent {
        source: signal.platform.source(),
        state: signal.state,
        generation,
        event_id: format!(
            "{}:{}:{}",
            signal.platform.wire_name(),
            signal.sequence,
            signal.timestamp_ms
        ),
        timestamp_ms: signal.timestamp_ms,
    };
    let result = process_lifecycle_event(&event)?;
    if result.accepted {
        sequences.insert(signal.platform, signal.sequence);
    }

    Ok(NativeLifecycleAcceptance {
        result,
        event: Some(event),
    })
}

fn signal_platform_matches(
    compiled_platform: Option<NativeLifecyclePlatform>,
    signal_platform: NativeLifecyclePlatform,
) -> bool {
    match compiled_platform {
        Some(compiled_platform) => compiled_platform == signal_platform,
        None => true,
    }
}

fn compiled_native_platform() -> Option<NativeLifecyclePlatform> {
    #[cfg(target_os = "android")]
    {
        return Some(NativeLifecyclePlatform::Android);
    }

    #[cfg(target_os = "ios")]
    {
        return Some(NativeLifecyclePlatform::Ios);
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        None
    }
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
    let mut processed_event_ids = lock_processed_event_ids_after_poison();
    LIFECYCLE_GENERATION.store(0, Ordering::Release);
    processed_event_ids.clear();
    drop(processed_event_ids);

    let mut native_sequences = match LAST_NATIVE_SIGNAL_SEQUENCE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::error!("lifecycle_bridge: recovering poisoned native sequence lock");
            poisoned.into_inner()
        }
    };
    native_sequences.clear();
}

fn lock_processed_event_ids() -> MobileResult<MutexGuard<'static, HashSet<String>>> {
    PROCESSED_EVENT_IDS
        .lock()
        .map_err(|_| MobileError::lifecycle("lifecycle event lock poisoned"))
}

fn lock_processed_event_ids_after_poison() -> MutexGuard<'static, HashSet<String>> {
    match PROCESSED_EVENT_IDS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::error!("lifecycle_bridge: recovering poisoned event identity lock");
            poisoned.into_inner()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn event(generation: u64, event_id: &str) -> NativeLifecycleEvent {
        NativeLifecycleEvent {
            source: NativeLifecycleSource::AndroidActivity,
            state: NativeLifecycleState::Foreground,
            generation,
            event_id: event_id.to_string(),
            timestamp_ms: 1,
        }
    }

    #[test]
    fn generation_is_monotonic_and_exact() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_lifecycle_bridge();

        assert_eq!(current_generation(), 0);
        assert_eq!(advance_generation(), 1);
        assert_eq!(advance_generation(), 2);
        assert!(is_current_generation(2));
        assert!(!is_current_generation(1));
        assert!(!is_current_generation(3));
    }

    #[test]
    fn rejects_stale_and_future_events() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_lifecycle_bridge();
        assert_eq!(advance_generation(), 1);

        let stale = process_lifecycle_event(&event(0, "stale")).expect("stale result");
        assert!(!stale.accepted);
        assert_eq!(
            stale.reason,
            Some(LifecycleRejectionReason::StaleGeneration)
        );

        let future = process_lifecycle_event(&event(2, "future")).expect("future result");
        assert!(!future.accepted);
        assert_eq!(
            future.reason,
            Some(LifecycleRejectionReason::FutureGeneration)
        );
    }

    #[test]
    fn rejects_non_consecutive_duplicates_within_a_generation() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_lifecycle_bridge();
        let generation = advance_generation();

        assert!(
            process_lifecycle_event(&event(generation, "event-a"))
                .expect("first event")
                .accepted
        );
        assert!(
            process_lifecycle_event(&event(generation, "event-b"))
                .expect("second event")
                .accepted
        );

        let duplicate =
            process_lifecycle_event(&event(generation, "event-a")).expect("duplicate result");
        assert!(!duplicate.accepted);
        assert_eq!(
            duplicate.reason,
            Some(LifecycleRejectionReason::DuplicateEventId)
        );

        let next_generation = advance_generation();
        assert!(
            process_lifecycle_event(&event(next_generation, "event-a"))
                .expect("new generation event")
                .accepted
        );
    }

    #[test]
    fn rejects_empty_event_identity_with_typed_error() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_lifecycle_bridge();

        let error = process_lifecycle_event(&event(0, " ")).expect_err("invalid event");
        assert_eq!(error.code, "MOBILE_INVALID_INPUT");
    }

    #[test]
    fn native_foreground_advances_generation_and_background_retains_it() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_lifecycle_bridge();

        let background = process_native_signal(&NativeLifecycleSignal {
            platform: NativeLifecyclePlatform::Android,
            state: NativeLifecycleState::Background,
            sequence: 1,
            timestamp_ms: 10,
        })
        .expect("background signal");
        assert!(background.result.accepted);
        assert_eq!(background.result.generation, 0);
        assert_eq!(
            background.event.expect("background event").state,
            NativeLifecycleState::Background
        );

        let foreground = process_native_signal(&NativeLifecycleSignal {
            platform: NativeLifecyclePlatform::Android,
            state: NativeLifecycleState::Foreground,
            sequence: 2,
            timestamp_ms: 20,
        })
        .expect("foreground signal");
        assert!(foreground.result.accepted);
        assert_eq!(foreground.result.generation, 1);
        assert_eq!(
            foreground.event.expect("foreground event").source,
            NativeLifecycleSource::AndroidActivity
        );
    }

    #[test]
    fn native_signal_sequence_rejects_duplicates_before_advancing_generation() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_lifecycle_bridge();

        let signal = NativeLifecycleSignal {
            platform: NativeLifecyclePlatform::Ios,
            state: NativeLifecycleState::Foreground,
            sequence: 1,
            timestamp_ms: 10,
        };
        let first = process_native_signal(&signal).expect("first signal");
        let duplicate = process_native_signal(&signal).expect("duplicate signal");

        assert!(first.result.accepted);
        assert!(!duplicate.result.accepted);
        assert_eq!(
            duplicate.result.reason,
            Some(LifecycleRejectionReason::StaleNativeSequence)
        );
        assert!(duplicate.event.is_none());
        assert_eq!(current_generation(), 1);
    }

    #[test]
    fn native_signal_requires_positive_sequence() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_lifecycle_bridge();

        let error = process_native_signal(&NativeLifecycleSignal {
            platform: NativeLifecyclePlatform::Ios,
            state: NativeLifecycleState::Foreground,
            sequence: 0,
            timestamp_ms: 10,
        })
        .expect_err("zero sequence");

        assert_eq!(error.code, "MOBILE_INVALID_INPUT");
    }

    #[test]
    fn platform_matching_rejects_cross_platform_signals() {
        assert!(signal_platform_matches(
            Some(NativeLifecyclePlatform::Android),
            NativeLifecyclePlatform::Android,
        ));
        assert!(!signal_platform_matches(
            Some(NativeLifecyclePlatform::Android),
            NativeLifecyclePlatform::Ios,
        ));
        assert!(!signal_platform_matches(
            Some(NativeLifecyclePlatform::Ios),
            NativeLifecyclePlatform::Android,
        ));
        assert!(signal_platform_matches(None, NativeLifecyclePlatform::Ios,));
    }
}
