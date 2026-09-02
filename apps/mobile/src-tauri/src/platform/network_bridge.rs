// Network Bridge — W7 network connectivity state for the Rust kernel.
//
// Tracks network state changes propagated from the native layer and
// exposes a typed API for the lifecycle bridge to consume. Wakeup
// events from network changes flow through the lifecycle generation
// system to prevent stale reconciliation.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkState {
    pub connected: bool,
    pub network_type: NetworkType,
    pub updated_at_ms: u64,
}

static IS_CONNECTED: AtomicBool = AtomicBool::new(true);
static NETWORK_STATE: Mutex<Option<NetworkState>> = Mutex::new(None);

/// Update the network state from a native connectivity change event.
pub fn update_network_state(connected: bool, network_type: NetworkType) {
    IS_CONNECTED.store(connected, Ordering::Release);
    let state = NetworkState {
        connected,
        network_type,
        updated_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    };
    if let Ok(mut guard) = NETWORK_STATE.lock() {
        *guard = Some(state);
    }
}

/// Check if the device currently has network connectivity.
pub fn is_connected() -> bool {
    IS_CONNECTED.load(Ordering::Acquire)
}

/// Get the full network state snapshot.
pub fn get_network_state() -> NetworkState {
    NETWORK_STATE
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .unwrap_or(NetworkState {
            connected: true,
            network_type: NetworkType::Unknown,
            updated_at_ms: 0,
        })
}

/// Reset network state to defaults (for testing / teardown).
pub fn reset_network_state() {
    IS_CONNECTED.store(true, Ordering::Release);
    if let Ok(mut guard) = NETWORK_STATE.lock() {
        *guard = None;
    }
}
