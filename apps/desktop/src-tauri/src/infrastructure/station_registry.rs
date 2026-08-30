// Station registry: manages known station entries with local JSON persistence.
//
// Provides add/remove/list/set_active operations and probe-result updates.
// Thread-safe via RwLock for concurrent gateway access.
//
// 2026-05-29: Initial creation for dynamic Station URL picker.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io;
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
    state: RwLock<PersistedData>,
    persist_path: PathBuf,
}

impl StationRegistry {
    /// Create a new registry, loading persisted state from `config_dir/stations.json`.
    pub fn new(config_dir: &std::path::Path) -> Self {
        let persist_path = config_dir.join("stations.json");
        let (state, seeded) = Self::load(&persist_path);
        let registry = Self {
            state: RwLock::new(state),
            persist_path,
        };
        if seeded {
            if let Err(error) = registry.save() {
                tracing::warn!(error = %error, "station_registry: failed to persist Station seed");
            }
        }
        registry
    }

    /// Load persisted data from disk.
    /// `PEERS_STATION_URL` is a discovery seed only. It never replaces the
    /// user's persisted active Station.
    fn load(path: &std::path::Path) -> (PersistedData, bool) {
        let seed_url = std::env::var("PEERS_STATION_URL")
            .ok()
            .map(|url| normalize_url(&url))
            .filter(|url| !url.is_empty());

        let mut state = std::fs::read_to_string(path)
            .ok()
            .and_then(|content| serde_json::from_str::<PersistedData>(&content).ok())
            .unwrap_or_default();

        state.entries.iter_mut().for_each(|entry| {
            entry.url = normalize_url(&entry.url);
        });
        let mut seen_urls = HashSet::new();
        state
            .entries
            .retain(|entry| !entry.url.is_empty() && seen_urls.insert(entry.url.clone()));
        state.active_url = state
            .active_url
            .map(|url| normalize_url(&url))
            .filter(|url| state.entries.iter().any(|entry| entry.url == *url));

        let mut seeded = false;
        if let Some(seed_url) = seed_url {
            if !state.entries.iter().any(|entry| entry.url == seed_url) {
                state.entries.push(empty_entry(seed_url));
                seeded = true;
            }
        }

        (state, seeded)
    }

    fn persist(&self, state: &PersistedData) -> io::Result<()> {
        let json = serde_json::to_string_pretty(state)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let temp_path = self.persist_path.with_extension("json.tmp");
        std::fs::write(&temp_path, json)?;
        std::fs::rename(temp_path, &self.persist_path)
    }

    fn save(&self) -> io::Result<()> {
        let state = self
            .state
            .read()
            .expect("StationRegistry read lock poisoned");
        self.persist(&state)
    }

    /// Returns the currently active station URL.
    pub fn active_url(&self) -> Option<String> {
        self.state
            .read()
            .expect("StationRegistry read lock poisoned")
            .active_url
            .clone()
    }

    /// Switch the active station URL. Persists immediately.
    pub fn set_active(&self, url: &str) -> io::Result<()> {
        let normalized = normalize_url(url);
        if normalized.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Station URL is required",
            ));
        }
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        if !state.entries.iter().any(|entry| entry.url == normalized) {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Station must be added before it can be selected",
            ));
        }
        let mut next = state.clone();
        next.active_url = Some(normalized);
        self.persist(&next)?;
        *state = next;
        Ok(())
    }

    /// List all known station entries.
    pub fn list(&self) -> Vec<StationEntry> {
        self.state
            .read()
            .expect("StationRegistry read lock poisoned")
            .entries
            .clone()
    }

    /// Add or refresh a station entry by normalized URL.
    pub fn add(&self, mut entry: StationEntry) -> io::Result<()> {
        entry.url = normalize_url(&entry.url);
        if entry.url.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Station URL is required",
            ));
        }
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        let mut next = state.clone();
        if let Some(current) = next
            .entries
            .iter_mut()
            .find(|current| current.url == entry.url)
        {
            *current = entry;
        } else {
            next.entries.push(entry);
        }
        self.persist(&next)?;
        *state = next;
        Ok(())
    }

    /// Remove a station by URL. Persists immediately.
    pub fn remove(&self, url: &str) -> io::Result<()> {
        let normalized = normalize_url(url);
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        let mut next = state.clone();
        next.entries.retain(|entry| entry.url != normalized);
        if next.active_url.as_deref() == Some(normalized.as_str()) {
            next.active_url = None;
        }
        self.persist(&next)?;
        *state = next;
        Ok(())
    }

    /// Update probe results for an existing entry. Persists immediately.
    pub fn update_probe(
        &self,
        url: &str,
        label: Option<String>,
        peer_id: Option<String>,
        peers_count: Option<u32>,
        online: bool,
    ) -> io::Result<()> {
        let normalized = normalize_url(url);
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        let mut next = state.clone();
        if let Some(entry) = next
            .entries
            .iter_mut()
            .find(|entry| entry.url == normalized)
        {
            entry.label = label;
            entry.peer_id = peer_id;
            entry.peers_count = peers_count;
            entry.online = online;
            entry.last_probe = Some(now_rfc3339());
        }
        self.persist(&next)?;
        *state = next;
        Ok(())
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
#[derive(Clone, Default, Serialize, Deserialize)]
struct PersistedData {
    #[serde(default)]
    entries: Vec<StationEntry>,
    #[serde(default)]
    active_url: Option<String>,
}

fn normalize_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

fn empty_entry(url: String) -> StationEntry {
    StationEntry {
        url,
        label: None,
        peer_id: None,
        peers_count: None,
        last_probe: None,
        online: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "peers-station-registry-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn with_seed(seed: Option<&str>, run: impl FnOnce()) {
        let _guard = ENV_LOCK.lock().unwrap();
        let previous = std::env::var_os("PEERS_STATION_URL");
        match seed {
            Some(value) => std::env::set_var("PEERS_STATION_URL", value),
            None => std::env::remove_var("PEERS_STATION_URL"),
        }
        run();
        match previous {
            Some(value) => std::env::set_var("PEERS_STATION_URL", value),
            None => std::env::remove_var("PEERS_STATION_URL"),
        }
    }

    #[test]
    fn starts_unbound_without_seed() {
        with_seed(None, || {
            let dir = temp_dir("unbound");
            let registry = StationRegistry::new(&dir);
            assert_eq!(registry.active_url(), None);
            assert!(registry.list().is_empty());
        });
    }

    #[test]
    fn seed_adds_entry_without_becoming_active() {
        with_seed(Some("http://seed.example/"), || {
            let dir = temp_dir("seed");
            let registry = StationRegistry::new(&dir);
            assert_eq!(registry.active_url(), None);
            assert_eq!(registry.list()[0].url, "http://seed.example");
        });
    }

    #[test]
    fn adding_existing_seed_refreshes_and_persists_probe_metadata() {
        with_seed(Some("http://seed.example/"), || {
            let dir = temp_dir("seed-refresh");
            let registry = StationRegistry::new(&dir);
            registry
                .add(StationEntry {
                    url: "http://seed.example/".to_string(),
                    label: Some("Seed Station".to_string()),
                    peer_id: Some("12D3KooWSeed".to_string()),
                    peers_count: Some(3),
                    last_probe: Some("2026-08-30T00:00:00Z".to_string()),
                    online: true,
                })
                .unwrap();
            registry.set_active("http://seed.example").unwrap();

            let refreshed = registry.list();
            assert_eq!(refreshed.len(), 1);
            assert_eq!(refreshed[0].peer_id.as_deref(), Some("12D3KooWSeed"));
            assert!(refreshed[0].online);

            let reloaded = StationRegistry::new(&dir);
            assert_eq!(reloaded.list()[0].peer_id.as_deref(), Some("12D3KooWSeed"));
            assert_eq!(
                reloaded.active_url().as_deref(),
                Some("http://seed.example")
            );
        });
    }

    #[test]
    fn persisted_selection_wins_over_different_seed() {
        with_seed(Some("http://seed.example"), || {
            let dir = temp_dir("persisted");
            let persisted = PersistedData {
                entries: vec![empty_entry("http://chosen.example".to_string())],
                active_url: Some("http://chosen.example".to_string()),
            };
            std::fs::write(
                dir.join("stations.json"),
                serde_json::to_string(&persisted).unwrap(),
            )
            .unwrap();

            let registry = StationRegistry::new(&dir);
            assert_eq!(
                registry.active_url().as_deref(),
                Some("http://chosen.example")
            );
            assert!(registry
                .list()
                .iter()
                .any(|entry| entry.url == "http://seed.example"));
        });
    }

    #[test]
    fn removing_active_station_leaves_registry_unbound() {
        with_seed(None, || {
            let dir = temp_dir("remove-active");
            let registry = StationRegistry::new(&dir);
            registry
                .add(empty_entry("http://chosen.example".to_string()))
                .unwrap();
            registry.set_active("http://chosen.example").unwrap();
            registry.remove("http://chosen.example").unwrap();
            assert_eq!(registry.active_url(), None);
        });
    }

    #[test]
    fn corrupt_file_degrades_to_empty_registry() {
        with_seed(None, || {
            let dir = temp_dir("corrupt");
            std::fs::write(dir.join("stations.json"), "{broken").unwrap();
            let registry = StationRegistry::new(&dir);
            assert_eq!(registry.active_url(), None);
            assert!(registry.list().is_empty());
        });
    }
}
