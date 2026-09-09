// Network Bridge — W7 network connectivity state for the Rust kernel.
//
// Tracks network state changes propagated from the native layer and
// exposes a typed API for the lifecycle bridge to consume. Wakeup
// events from network changes flow through the lifecycle generation
// system to prevent stale reconciliation.

use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

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

const UNOBSERVED_NETWORK_STATE: NetworkState = NetworkState {
    connected: true,
    network_type: NetworkType::Unknown,
    updated_at_ms: 0,
};

static NETWORK_STATE: Mutex<NetworkState> = Mutex::new(UNOBSERVED_NETWORK_STATE);

/// Update the network state from a native connectivity change event.
pub fn update_network_state(connected: bool, network_type: NetworkType) {
    let network_type = match (connected, network_type) {
        (false, _) => NetworkType::None,
        (true, NetworkType::None) => NetworkType::Unknown,
        (true, observed) => observed,
    };
    let mut state = lock_network_state();
    *state = NetworkState {
        connected,
        network_type,
        updated_at_ms: current_time_ms(),
    };
}

/// Check if the device currently has network connectivity.
pub fn is_connected() -> bool {
    get_network_state().connected
}

/// Get the full network state snapshot.
pub fn get_network_state() -> NetworkState {
    *lock_network_state()
}

/// Reset network state to defaults (for testing / teardown).
pub fn reset_network_state() {
    *lock_network_state() = UNOBSERVED_NETWORK_STATE;
}

fn lock_network_state() -> MutexGuard<'static, NetworkState> {
    match NETWORK_STATE.lock() {
        Ok(state) => state,
        Err(poisoned) => {
            log::error!("network_bridge: recovering poisoned network state lock");
            poisoned.into_inner()
        }
    }
}

fn current_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
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
        update_network_state(false, NetworkType::Wifi);

        let state = get_network_state();
        assert!(!state.connected);
        assert_eq!(state.network_type, NetworkType::None);
        assert!(!is_connected());
    }

    #[test]
    fn connected_readback_uses_the_same_snapshot_as_connectivity_check() {
        let _test_guard = TEST_LOCK.lock().expect("test lock");
        reset_network_state();
        update_network_state(true, NetworkType::Wifi);

        let state = get_network_state();
        assert!(state.connected);
        assert_eq!(state.network_type, NetworkType::Wifi);
        assert!(state.updated_at_ms > 0);
        assert_eq!(is_connected(), state.connected);
    }
}
