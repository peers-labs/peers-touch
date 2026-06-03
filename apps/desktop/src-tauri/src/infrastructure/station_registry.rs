// Station registry: manages known station entries with local JSON persistence.
//
// Provides add/remove/list/set_active operations and probe-result updates.
// Thread-safe via RwLock for concurrent gateway access.
//
// 2026-05-29: Initial creation for dynamic Station URL picker.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

/// A single known Station entry with optional metadata from probing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StationEntry {
    pub url: String,
    pub label: Option<String>,
    pub peer_id: Option<String>,
    pub peers_count: Option<u32>,
    pub last_probe: Option<String>,
    pub online: bool,
}

/// Thread-safe registry of known stations, persisted to `stations.json`.
pub struct StationRegistry {
    entries: RwLock<Vec<StationEntry>>,
    active_url: RwLock<String>,
    persist_path: PathBuf,
}

impl StationRegistry {
    /// Create a new registry, loading persisted state from `config_dir/stations.json`.
    pub fn new(config_dir: &std::path::Path) -> Self {
        let persist_path = config_dir.join("stations.json");
        let (entries, active_url) = Self::load(&persist_path);
        Self {
            entries: RwLock::new(entries),
            active_url: RwLock::new(active_url),
            persist_path,
        }
    }

    /// Load persisted data from disk; falls back to env-var default on any error.
    /// Ensures the active URL always appears in the entries list.
    fn load(path: &std::path::Path) -> (Vec<StationEntry>, String) {
        let default_url = std::env::var("PEERS_STATION_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:18080".to_string())
            .trim_end_matches('/')
            .to_string();

        let (mut entries, active) = if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(data) = serde_json::from_str::<PersistedData>(&content) {
                let active = data
                    .active_url
                    .filter(|u| !u.trim().is_empty())
                    .unwrap_or_else(|| default_url.clone());
                (data.entries, active)
            } else {
                (vec![], default_url.clone())
            }
        } else {
            (vec![], default_url.clone())
        };

        // Ensure the active URL is always present in entries so the picker shows it.
        if !active.is_empty() && !entries.iter().any(|e| e.url == active) {
            entries.insert(0, StationEntry {
                url: active.clone(),
                label: None,
                peer_id: None,
                peers_count: None,
                last_probe: None,
                online: false,
            });
        }

        (entries, active)
    }

    /// Persist current state to disk. Best-effort — errors are logged, not propagated.
    fn save(&self) {
        let entries = self.entries.read().unwrap().clone();
        let active = self.active_url.read().unwrap().clone();
        let data = PersistedData {
            entries,
            active_url: Some(active),
        };
        match serde_json::to_string_pretty(&data) {
            Ok(json) => {
                if let Err(e) = std::fs::write(&self.persist_path, json) {
                    tracing::warn!(
                        error = %e,
                        path = %self.persist_path.display(),
                        "station_registry: failed to persist"
                    );
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, "station_registry: failed to serialize");
            }
        }
    }

    /// Returns the currently active station URL.
    pub fn active_url(&self) -> String {
        self.active_url.read().unwrap().clone()
    }

    /// Switch the active station URL. Persists immediately.
    pub fn set_active(&self, url: &str) {
        let normalized = url.trim_end_matches('/').to_string();
        *self.active_url.write().unwrap() = normalized;
        self.save();
    }

    /// List all known station entries.
    pub fn list(&self) -> Vec<StationEntry> {
        self.entries.read().unwrap().clone()
    }

    /// Add a new station entry. Deduplicates by normalized URL.
    pub fn add(&self, entry: StationEntry) {
        let normalized = entry.url.trim_end_matches('/').to_string();
        let mut entries = self.entries.write().unwrap();
        if !entries
            .iter()
            .any(|e| e.url.trim_end_matches('/') == normalized)
        {
            entries.push(entry);
        }
        drop(entries);
        self.save();
    }

    /// Remove a station by URL. Persists immediately.
    pub fn remove(&self, url: &str) {
        let normalized = url.trim_end_matches('/');
        let mut entries = self.entries.write().unwrap();
        entries.retain(|e| e.url.trim_end_matches('/') != normalized);
        drop(entries);
        self.save();
    }

    /// Update probe results for an existing entry. Persists immediately.
    pub fn update_probe(
        &self,
        url: &str,
        label: Option<String>,
        peer_id: Option<String>,
        peers_count: Option<u32>,
        online: bool,
    ) {
        let normalized = url.trim_end_matches('/');
        let mut entries = self.entries.write().unwrap();
        if let Some(entry) = entries
            .iter_mut()
            .find(|e| e.url.trim_end_matches('/') == normalized)
        {
            entry.label = label;
            entry.peer_id = peer_id;
            entry.peers_count = peers_count;
            entry.online = online;
            entry.last_probe = Some(now_rfc3339());
        }
        drop(entries);
        self.save();
    }
}

// -- Private helpers --

/// ISO-8601 / RFC-3339 timestamp using the `time` crate (already in Cargo.toml).
fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

/// On-disk JSON structure for `stations.json`.
#[derive(Serialize, Deserialize)]
struct PersistedData {
    entries: Vec<StationEntry>,
    active_url: Option<String>,
}
