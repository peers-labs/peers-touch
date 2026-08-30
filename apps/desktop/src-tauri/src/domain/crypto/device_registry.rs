//! Local cache of peer device lists.
//!
//! Tracks which devices each peer has, their public keys, and staleness.
//! The registry is populated from Station responses and used by the
//! session manager to determine encryption targets.

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::error::CryptoError;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Information about a single device belonging to a peer.
#[derive(Clone, Debug)]
pub struct DeviceInfo {
    /// Unique device identifier.
    pub device_id: String,
    /// Ed25519 device signing key (verifying/public).
    pub dsk_pub: [u8; 32],
    /// Cross-signature by the peer's IK over (dsk_pub || device_id).
    pub cross_signature: Vec<u8>,
    /// X25519 signed pre-key public for this device.
    pub spk_pub: [u8; 32],
    /// Whether this device has been verified by the local user.
    pub verified: bool,
    /// When this device entry was last updated (unix millis).
    pub last_updated_ms: i64,
}

/// The full device list for a single peer.
#[derive(Clone, Debug)]
pub struct PeerDeviceList {
    /// Peer actor DID.
    pub peer_ptid: String,
    /// Known devices for this peer.
    pub devices: Vec<DeviceInfo>,
    /// When this list was last fetched from Station (unix millis).
    pub fetched_at_ms: i64,
}

/// Local device registry — caches peer device lists in memory.
pub struct DeviceRegistry {
    /// Peer DID → device list.
    entries: HashMap<String, PeerDeviceList>,
    /// Maximum age before a device list is considered stale.
    staleness_threshold: Duration,
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

impl DeviceRegistry {
    /// Create a new registry with the given staleness threshold.
    pub fn new(staleness_threshold: Duration) -> Self {
        Self {
            entries: HashMap::new(),
            staleness_threshold,
        }
    }

    /// Create with a default staleness threshold of 1 hour.
    pub fn with_default_staleness() -> Self {
        Self::new(Duration::from_secs(3600))
    }

    /// Update or insert the device list for a peer.
    pub fn upsert(&mut self, list: PeerDeviceList) {
        self.entries.insert(list.peer_ptid.clone(), list);
    }

    /// Get the device list for a peer if it exists and is not stale.
    pub fn get_fresh(&self, peer_ptid: &str) -> Result<&PeerDeviceList, CryptoError> {
        let list = self.entries.get(peer_ptid).ok_or_else(|| {
            CryptoError::DeviceListUnavailable(format!("no entry for {peer_ptid}"))
        })?;

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let age_ms = now_ms - list.fetched_at_ms;
        let threshold_ms = self.staleness_threshold.as_millis() as i64;

        if age_ms > threshold_ms {
            return Err(CryptoError::DeviceListUnavailable(format!(
                "device list for {peer_ptid} is stale (age={age_ms}ms > threshold={threshold_ms}ms)"
            )));
        }

        Ok(list)
    }

    /// Get device list regardless of staleness (for best-effort operations).
    pub fn get_any(&self, peer_ptid: &str) -> Option<&PeerDeviceList> {
        self.entries.get(peer_ptid)
    }

    /// Check if a specific device is known for a peer.
    pub fn has_device(&self, peer_ptid: &str, device_id: &str) -> bool {
        self.entries
            .get(peer_ptid)
            .map(|list| list.devices.iter().any(|d| d.device_id == device_id))
            .unwrap_or(false)
    }

    /// Get all device IDs for a peer (even if stale).
    pub fn device_ids(&self, peer_ptid: &str) -> Vec<String> {
        self.entries
            .get(peer_ptid)
            .map(|list| list.devices.iter().map(|d| d.device_id.clone()).collect())
            .unwrap_or_default()
    }

    /// Mark a device as verified by the local user.
    pub fn mark_verified(&mut self, peer_ptid: &str, device_id: &str) -> Result<(), CryptoError> {
        let list = self.entries.get_mut(peer_ptid).ok_or_else(|| {
            CryptoError::DeviceListUnavailable(format!("no entry for {peer_ptid}"))
        })?;
        let device = list
            .devices
            .iter_mut()
            .find(|d| d.device_id == device_id)
            .ok_or_else(|| {
                CryptoError::DeviceListUnavailable(format!(
                    "device {device_id} not found for {peer_ptid}"
                ))
            })?;
        device.verified = true;
        Ok(())
    }

    /// Remove a device from the registry (e.g. device revoked).
    pub fn remove_device(&mut self, peer_ptid: &str, device_id: &str) {
        if let Some(list) = self.entries.get_mut(peer_ptid) {
            list.devices.retain(|d| d.device_id != device_id);
        }
    }

    /// Remove all data for a peer.
    pub fn remove_peer(&mut self, peer_ptid: &str) {
        self.entries.remove(peer_ptid);
    }

    /// Check if any device for a peer is unverified (for UI warnings).
    pub fn has_unverified_devices(&self, peer_ptid: &str) -> bool {
        self.entries
            .get(peer_ptid)
            .map(|list| list.devices.iter().any(|d| !d.verified))
            .unwrap_or(false)
    }

    /// Number of peers in the registry.
    pub fn peer_count(&self) -> usize {
        self.entries.len()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    }

    fn sample_device(id: &str) -> DeviceInfo {
        DeviceInfo {
            device_id: id.to_string(),
            dsk_pub: [1u8; 32],
            cross_signature: vec![0u8; 64],
            spk_pub: [2u8; 32],
            verified: false,
            last_updated_ms: now_ms(),
        }
    }

    #[test]
    fn upsert_and_get_fresh() {
        let mut reg = DeviceRegistry::with_default_staleness();
        let list = PeerDeviceList {
            peer_ptid: "peer-1".into(),
            devices: vec![sample_device("dev-a"), sample_device("dev-b")],
            fetched_at_ms: now_ms(),
        };
        reg.upsert(list);
        let fetched = reg.get_fresh("peer-1").expect("should be fresh");
        assert_eq!(fetched.devices.len(), 2);
    }

    #[test]
    fn stale_list_rejected() {
        let mut reg = DeviceRegistry::new(Duration::from_millis(1));
        let list = PeerDeviceList {
            peer_ptid: "peer-2".into(),
            devices: vec![sample_device("dev-x")],
            fetched_at_ms: now_ms() - 1000, // 1 second ago, threshold is 1ms.
        };
        reg.upsert(list);
        assert!(reg.get_fresh("peer-2").is_err());
    }

    #[test]
    fn device_verification() {
        let mut reg = DeviceRegistry::with_default_staleness();
        let list = PeerDeviceList {
            peer_ptid: "peer-3".into(),
            devices: vec![sample_device("dev-v")],
            fetched_at_ms: now_ms(),
        };
        reg.upsert(list);
        assert!(reg.has_unverified_devices("peer-3"));

        reg.mark_verified("peer-3", "dev-v").unwrap();
        assert!(!reg.has_unverified_devices("peer-3"));
    }
}
