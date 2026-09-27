// Network Bridge — W7 network connectivity state for the Rust kernel.
//
// Tracks network state changes propagated from the native layer and
// exposes a typed API for the lifecycle bridge to consume. Wakeup
// events from network changes flow through the lifecycle generation
// system to prevent stale reconciliation.

use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use crate::error::{MobileError, MobileResult};
use crate::platform::lifecycle_bridge;

// ---------------------------------------------------------------------------
// Network state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NetworkType {
    None,
    Wifi,
    Cellular,
    Ethernet,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkState {
    pub connected: bool,
    pub network_type: NetworkType,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeNetworkPlatform {
    Android,
    Ios,
}

impl NativeNetworkPlatform {
    fn wire_name(self) -> &'static str {
        match self {
            Self::Android => "android",
            Self::Ios => "ios",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNetworkSignal {
    pub platform: NativeNetworkPlatform,
    pub connected: bool,
    pub network_type: NetworkType,
    pub sequence: u64,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNetworkIngestResult {
    pub accepted: bool,
    pub connection_restored: bool,
    pub generation: u64,
    pub state: NetworkState,
}

const UNOBSERVED_NETWORK_STATE: NetworkState = NetworkState {
    connected: true,
    network_type: NetworkType::Unknown,
    updated_at_ms: 0,
};

#[derive(Debug, Clone, Copy)]
struct NetworkObservation {
    state: NetworkState,
    last_native_sequence: u64,
}

const UNOBSERVED_NETWORK_OBSERVATION: NetworkObservation = NetworkObservation {
    state: UNOBSERVED_NETWORK_STATE,
    last_native_sequence: 0,
};

static NETWORK_OBSERVATION: Mutex<NetworkObservation> = Mutex::new(UNOBSERVED_NETWORK_OBSERVATION);

/// Validate and apply one native connectivity observation.
///
/// The native sequence is process-local and rejects duplicate or reordered
/// callbacks. Browser reachability never writes this state.
pub fn ingest_native_signal(
    signal: NativeNetworkSignal,
) -> MobileResult<NativeNetworkIngestResult> {
    validate_native_signal(&signal)?;

    let mut observation = lock_network_observation();
    if signal.sequence <= observation.last_native_sequence {
        return Ok(NativeNetworkIngestResult {
            accepted: false,
            connection_restored: false,
            generation: lifecycle_bridge::current_generation(),
            state: observation.state,
        });
    }

    let connection_restored =
        signal.connected && (!observation.state.connected || observation.state.updated_at_ms == 0);
    observation.state = NetworkState {
        connected: signal.connected,
        network_type: signal.network_type,
        updated_at_ms: signal.timestamp_ms,
    };
    observation.last_native_sequence = signal.sequence;

    Ok(NativeNetworkIngestResult {
        accepted: true,
        connection_restored,
        generation: lifecycle_bridge::current_generation(),
        state: observation.state,
    })
}

/// Check if the device currently has network connectivity.
pub fn is_connected() -> bool {
    get_network_state().connected
}

/// Get the full network state snapshot.
pub fn get_network_state() -> NetworkState {
    lock_network_observation().state
}

/// Reset network state to defaults (for testing / teardown).
#[cfg(test)]
pub fn reset_network_state() {
    *lock_network_observation() = UNOBSERVED_NETWORK_OBSERVATION;
}

fn validate_native_signal(signal: &NativeNetworkSignal) -> MobileResult<()> {
    if signal.sequence == 0 {
        return Err(MobileError::network(
            "native network sequence must be greater than zero",
        ));
    }
    if signal.timestamp_ms == 0 {
        return Err(MobileError::network(
            "native network timestamp must be greater than zero",
        ));
    }
    if !platform_matches_compiled_target(signal.platform) {
        return Err(MobileError::network(format!(
            "native network platform {} does not match the compiled target",
            signal.platform.wire_name()
        )));
    }
    if (!signal.connected && signal.network_type != NetworkType::None)
        || (signal.connected && signal.network_type == NetworkType::None)
    {
        return Err(MobileError::network(
            "native network connectivity and transport type are inconsistent",
        ));
    }
    Ok(())
}

fn platform_matches_compiled_target(signal_platform: NativeNetworkPlatform) -> bool {
    compiled_native_platform().is_none_or(|platform| platform == signal_platform)
}

fn compiled_native_platform() -> Option<NativeNetworkPlatform> {
    #[cfg(target_os = "android")]
    {
        return Some(NativeNetworkPlatform::Android);
    }

    #[cfg(target_os = "ios")]
    {
        return Some(NativeNetworkPlatform::Ios);
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        None
    }
}

fn lock_network_observation() -> MutexGuard<'static, NetworkObservation> {
    match NETWORK_OBSERVATION.lock() {
        Ok(observation) => observation,
        Err(poisoned) => {
            log::error!("network_bridge: recovering poisoned network observation lock");
            poisoned.into_inner()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn unobserved_network_remains_unknown_without_fabricating_offline_state() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_network_state();

        assert_eq!(get_network_state(), UNOBSERVED_NETWORK_STATE);
        assert!(is_connected());
    }

    #[test]
    fn disconnected_readback_cannot_retain_a_connected_transport() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_network_state();
        let result = ingest_native_signal(NativeNetworkSignal {
            platform: NativeNetworkPlatform::Ios,
            connected: false,
            network_type: NetworkType::None,
            sequence: 1,
            timestamp_ms: 10,
        })
        .expect("offline signal");

        let state = get_network_state();
        assert!(result.accepted);
        assert!(!state.connected);
        assert_eq!(state.network_type, NetworkType::None);
        assert!(!is_connected());
    }

    #[test]
    fn connected_readback_uses_the_same_snapshot_as_connectivity_check() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_network_state();
        let result = ingest_native_signal(NativeNetworkSignal {
            platform: NativeNetworkPlatform::Ios,
            connected: true,
            network_type: NetworkType::Wifi,
            sequence: 1,
            timestamp_ms: 10,
        })
        .expect("online signal");

        let state = get_network_state();
        assert!(result.accepted);
        assert!(result.connection_restored);
        assert!(state.connected);
        assert_eq!(state.network_type, NetworkType::Wifi);
        assert_eq!(state.updated_at_ms, 10);
        assert_eq!(is_connected(), state.connected);
    }

    #[test]
    fn stale_native_sequence_cannot_overwrite_newer_state() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_network_state();
        ingest_native_signal(NativeNetworkSignal {
            platform: NativeNetworkPlatform::Ios,
            connected: true,
            network_type: NetworkType::Cellular,
            sequence: 2,
            timestamp_ms: 20,
        })
        .expect("newer signal");

        let stale = ingest_native_signal(NativeNetworkSignal {
            platform: NativeNetworkPlatform::Ios,
            connected: false,
            network_type: NetworkType::None,
            sequence: 1,
            timestamp_ms: 10,
        })
        .expect("stale signal result");

        assert!(!stale.accepted);
        assert_eq!(
            stale.state,
            NetworkState {
                connected: true,
                network_type: NetworkType::Cellular,
                updated_at_ms: 20,
            }
        );
    }

    #[test]
    fn inconsistent_native_network_state_fails_closed() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_network_state();

        let error = ingest_native_signal(NativeNetworkSignal {
            platform: NativeNetworkPlatform::Ios,
            connected: false,
            network_type: NetworkType::Wifi,
            sequence: 1,
            timestamp_ms: 10,
        })
        .expect_err("inconsistent signal");

        assert_eq!(error.code, "MOBILE_NETWORK");
        assert_eq!(get_network_state(), UNOBSERVED_NETWORK_STATE);
    }
}
