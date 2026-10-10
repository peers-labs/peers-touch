use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io;
use std::path::PathBuf;
use std::sync::RwLock;

use crate::infrastructure::station_discovery::VerifiedStationRoute;

const REGISTRY_VERSION: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StationRouteType {
    Direct,
    Relay,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StationRouteHealth {
    Available,
    Degraded,
    Unavailable,
    Revoked,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StationRouteCandidate {
    pub route_id: String,
    pub route_type: StationRouteType,
    pub transport: String,
    pub endpoint_origin: String,
    pub relay_peer_id: Option<String>,
    pub route_generation: u64,
    pub inner_tls_spki_sha256: Option<Vec<u8>>,
    pub attestation_bytes: Option<Vec<u8>>,
    #[serde(default)]
    pub connection_grant: Option<Vec<u8>>,
    pub attestation_expires_at_unix_ms: Option<i64>,
    pub last_verified_at: String,
    pub last_success_at: Option<String>,
    pub health: StationRouteHealth,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StationEntry {
    pub station_peer_id: String,
    pub display_name: Option<String>,
    pub pinned_host_public_key: Vec<u8>,
    pub routes: Vec<StationRouteCandidate>,
    pub active_route_id: String,
    pub route_revision: u64,
    pub lifecycle_generation: u64,
    pub created_at: String,
    pub updated_at: String,
}

impl StationEntry {
    pub fn active_route(&self) -> Option<&StationRouteCandidate> {
        self.routes
            .iter()
            .find(|route| route.route_id == self.active_route_id)
    }
}

pub struct StationRegistry {
    state: RwLock<PersistedData>,
    persist_path: PathBuf,
    discovery_seed: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FederationSigningKeyPin {
    pub station_peer_id: String,
    pub signing_key_id: String,
    pub ed25519_public_key: [u8; 32],
}

impl StationRegistry {
    pub fn new(config_dir: &std::path::Path) -> Self {
        let persist_path = config_dir.join("stations.json");
        let discovery_seed = std::env::var("PEERS_STATION_URL")
            .ok()
            .map(|value| normalize_origin(&value))
            .filter(|value| !value.is_empty());
        let (state, migrated) = Self::load(&persist_path);
        let registry = Self {
            state: RwLock::new(state),
            persist_path,
            discovery_seed,
        };
        if migrated {
            if let Err(error) = registry.save() {
                tracing::warn!(error = %error, "station_registry: failed to persist v2 migration");
            }
        }
        registry
    }

    fn load(path: &std::path::Path) -> (PersistedData, bool) {
        let Some(raw) = std::fs::read_to_string(path).ok() else {
            return (PersistedData::default(), false);
        };
        if let Ok(mut state) = serde_json::from_str::<PersistedData>(&raw) {
            state.sanitize();
            return (state, false);
        }
        if let Ok(legacy) = serde_json::from_str::<LegacyPersistedData>(&raw) {
            return (migrate_legacy(legacy), true);
        }
        (PersistedData::default(), false)
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

    pub fn discovery_seed(&self) -> Option<String> {
        self.discovery_seed.clone()
    }

    pub fn active_station_peer_id(&self) -> Option<String> {
        self.state
            .read()
            .expect("StationRegistry read lock poisoned")
            .active_station_peer_id
            .clone()
    }

    pub fn active_entry(&self) -> Option<StationEntry> {
        let state = self
            .state
            .read()
            .expect("StationRegistry read lock poisoned");
        let active = state.active_station_peer_id.as_deref()?;
        state
            .entries
            .iter()
            .find(|entry| entry.station_peer_id == active)
            .cloned()
    }

    pub fn active_route(&self) -> Option<StationRouteCandidate> {
        self.active_entry()?.active_route().cloned()
    }

    pub fn active_endpoint_origin(&self) -> Option<String> {
        self.active_route().map(|route| route.endpoint_origin)
    }

    pub fn list(&self) -> Vec<StationEntry> {
        self.state
            .read()
            .expect("StationRegistry read lock poisoned")
            .entries
            .clone()
    }

    pub fn entry(&self, station_peer_id: &str) -> Option<StationEntry> {
        self.state
            .read()
            .expect("StationRegistry read lock poisoned")
            .entries
            .iter()
            .find(|entry| entry.station_peer_id == station_peer_id)
            .cloned()
    }

    pub fn entry_for_origin(&self, origin: &str) -> Option<StationEntry> {
        let normalized = normalize_origin(origin);
        self.state
            .read()
            .expect("StationRegistry read lock poisoned")
            .entries
            .iter()
            .find(|entry| {
                entry
                    .routes
                    .iter()
                    .any(|route| route.endpoint_origin == normalized)
            })
            .cloned()
    }

    pub fn upsert_verified_route(
        &self,
        route: &VerifiedStationRoute,
        display_name: Option<String>,
    ) -> io::Result<StationEntry> {
        if route.station_peer_id.trim().is_empty()
            || route.station_host_public_key.is_empty()
            || route.route_id.trim().is_empty()
            || route.endpoint_origin.trim().is_empty()
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Verified Station route is incomplete",
            ));
        }
        let now = now_rfc3339();
        let candidate = route_candidate(route, &now);
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        let mut next = state.clone();
        if let Some(entry) = next
            .entries
            .iter_mut()
            .find(|entry| entry.station_peer_id == route.station_peer_id)
        {
            if entry.pinned_host_public_key != route.station_host_public_key {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Station host identity changed without explicit replacement",
                ));
            }
            if let Some(existing) = entry
                .routes
                .iter_mut()
                .find(|existing| existing.route_id == candidate.route_id)
            {
                *existing = candidate;
            } else {
                entry.routes.push(candidate);
            }
            if entry.active_route_id.is_empty() {
                entry.active_route_id = route.route_id.clone();
            }
            if display_name.is_some() {
                entry.display_name = display_name;
            }
            entry.updated_at = now;
        } else {
            next.entries.push(StationEntry {
                station_peer_id: route.station_peer_id.clone(),
                display_name,
                pinned_host_public_key: route.station_host_public_key.clone(),
                routes: vec![candidate],
                active_route_id: route.route_id.clone(),
                route_revision: 1,
                lifecycle_generation: 1,
                created_at: now.clone(),
                updated_at: now,
            });
        }
        let entry = next
            .entries
            .iter()
            .find(|entry| entry.station_peer_id == route.station_peer_id)
            .cloned()
            .expect("upserted Station entry must exist");
        self.persist(&next)?;
        *state = next;
        Ok(entry)
    }

    pub fn set_active_station(&self, station_peer_id: &str) -> io::Result<StationEntry> {
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        let mut next = state.clone();
        let changing_station = next.active_station_peer_id.as_deref() != Some(station_peer_id);
        let entry = next
            .entries
            .iter_mut()
            .find(|entry| entry.station_peer_id == station_peer_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Station is not registered"))?;
        if entry.active_route().is_none() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Station has no active verified route",
            ));
        }
        if changing_station && next.active_station_peer_id.is_some() {
            entry.lifecycle_generation = entry.lifecycle_generation.saturating_add(1);
        }
        entry.updated_at = now_rfc3339();
        next.active_station_peer_id = Some(station_peer_id.to_string());
        let selected = entry.clone();
        self.persist(&next)?;
        *state = next;
        Ok(selected)
    }

    pub fn set_active_route(
        &self,
        station_peer_id: &str,
        route_id: &str,
    ) -> io::Result<StationEntry> {
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        let mut next = state.clone();
        let entry = next
            .entries
            .iter_mut()
            .find(|entry| entry.station_peer_id == station_peer_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Station is not registered"))?;
        let route = entry
            .routes
            .iter()
            .find(|route| route.route_id == route_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Station route is unknown"))?;
        if matches!(
            route.health,
            StationRouteHealth::Unavailable | StationRouteHealth::Revoked
        ) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Station route is unavailable",
            ));
        }
        if entry.active_route_id != route_id {
            entry.active_route_id = route_id.to_string();
            entry.route_revision = entry.route_revision.saturating_add(1);
            entry.updated_at = now_rfc3339();
        }
        let selected = entry.clone();
        self.persist(&next)?;
        *state = next;
        Ok(selected)
    }

    pub fn remove(&self, station_peer_id: &str) -> io::Result<()> {
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        let mut next = state.clone();
        next.entries
            .retain(|entry| entry.station_peer_id != station_peer_id);
        next.federation_signing_key_pins.remove(station_peer_id);
        if next.active_station_peer_id.as_deref() == Some(station_peer_id) {
            next.active_station_peer_id = None;
        }
        self.persist(&next)?;
        *state = next;
        Ok(())
    }

    pub fn mark_route_health(
        &self,
        station_peer_id: &str,
        route_id: &str,
        health: StationRouteHealth,
    ) -> io::Result<StationEntry> {
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        let mut next = state.clone();
        let entry = next
            .entries
            .iter_mut()
            .find(|entry| entry.station_peer_id == station_peer_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Station is not registered"))?;
        let route = entry
            .routes
            .iter_mut()
            .find(|route| route.route_id == route_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Station route is unknown"))?;
        route.health = health;
        route.last_verified_at = now_rfc3339();
        if health == StationRouteHealth::Available {
            route.last_success_at = Some(route.last_verified_at.clone());
        }
        entry.updated_at = route.last_verified_at.clone();
        let updated = entry.clone();
        self.persist(&next)?;
        *state = next;
        Ok(updated)
    }

    pub fn pin_or_verify_federation_signing_key(
        &self,
        station_peer_id: &str,
        signing_key_id: &str,
        ed25519_public_key: [u8; 32],
    ) -> io::Result<FederationSigningKeyPin> {
        if station_peer_id.trim().is_empty() || signing_key_id.trim().is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Station Federation signing-key pin is incomplete",
            ));
        }
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        if !state
            .entries
            .iter()
            .any(|entry| entry.station_peer_id == station_peer_id)
        {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Station must be registered before its Federation key is pinned",
            ));
        }
        let candidate = PersistedFederationSigningKeyPin {
            signing_key_id: signing_key_id.to_string(),
            ed25519_public_key: ed25519_public_key.to_vec(),
        };
        if let Some(existing) = state.federation_signing_key_pins.get(station_peer_id) {
            if existing != &candidate {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Station Federation signing key changed without explicit Station replacement",
                ));
            }
        } else {
            let mut next = state.clone();
            next.federation_signing_key_pins
                .insert(station_peer_id.to_string(), candidate);
            self.persist(&next)?;
            *state = next;
        }
        Ok(FederationSigningKeyPin {
            station_peer_id: station_peer_id.to_string(),
            signing_key_id: signing_key_id.to_string(),
            ed25519_public_key,
        })
    }

    pub fn federation_signing_key_pin(
        &self,
        station_peer_id: &str,
    ) -> io::Result<Option<FederationSigningKeyPin>> {
        let state = self
            .state
            .read()
            .expect("StationRegistry read lock poisoned");
        if !state
            .entries
            .iter()
            .any(|entry| entry.station_peer_id == station_peer_id)
        {
            return Ok(None);
        }
        state
            .federation_signing_key_pins
            .get(station_peer_id)
            .map(|pin| {
                let public_key: [u8; 32] =
                    pin.ed25519_public_key.as_slice().try_into().map_err(|_| {
                        io::Error::new(
                            io::ErrorKind::InvalidData,
                            "Pinned Station Federation signing key is malformed",
                        )
                    })?;
                Ok(FederationSigningKeyPin {
                    station_peer_id: station_peer_id.to_string(),
                    signing_key_id: pin.signing_key_id.clone(),
                    ed25519_public_key: public_key,
                })
            })
            .transpose()
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct PersistedData {
    version: u32,
    #[serde(default)]
    entries: Vec<StationEntry>,
    #[serde(default)]
    active_station_peer_id: Option<String>,
    #[serde(default)]
    federation_signing_key_pins: HashMap<String, PersistedFederationSigningKeyPin>,
}

impl Default for PersistedData {
    fn default() -> Self {
        Self {
            version: REGISTRY_VERSION,
            entries: Vec::new(),
            active_station_peer_id: None,
            federation_signing_key_pins: HashMap::new(),
        }
    }
}

impl PersistedData {
    fn sanitize(&mut self) {
        self.version = REGISTRY_VERSION;
        let mut station_ids = HashSet::new();
        self.entries.retain_mut(|entry| {
            entry.station_peer_id = entry.station_peer_id.trim().to_string();
            entry.routes.iter_mut().for_each(|route| {
                route.endpoint_origin = normalize_origin(&route.endpoint_origin);
            });
            let mut route_ids = HashSet::new();
            entry.routes.retain(|route| {
                !route.route_id.trim().is_empty()
                    && !route.endpoint_origin.is_empty()
                    && route_ids.insert(route.route_id.clone())
            });
            !entry.station_peer_id.is_empty()
                && !entry.pinned_host_public_key.is_empty()
                && entry.active_route().is_some()
                && station_ids.insert(entry.station_peer_id.clone())
        });
        if !self.entries.iter().any(|entry| {
            Some(entry.station_peer_id.as_str()) == self.active_station_peer_id.as_deref()
        }) {
            self.active_station_peer_id = None;
        }
        self.federation_signing_key_pins
            .retain(|station_peer_id, _| {
                self.entries
                    .iter()
                    .any(|entry| entry.station_peer_id == *station_peer_id)
            });
    }
}

#[derive(Clone, Default, Deserialize)]
struct LegacyPersistedData {
    #[serde(default)]
    entries: Vec<LegacyStationEntry>,
    #[serde(default)]
    active_url: Option<String>,
    #[serde(default)]
    federation_signing_key_pins: HashMap<String, LegacyFederationSigningKeyPin>,
}

#[derive(Clone, Deserialize)]
struct LegacyStationEntry {
    url: String,
    label: Option<String>,
    peer_id: Option<String>,
    last_probe: Option<String>,
    online: bool,
}

#[derive(Clone, Deserialize)]
struct LegacyFederationSigningKeyPin {
    signing_key_id: String,
    ed25519_public_key: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct PersistedFederationSigningKeyPin {
    signing_key_id: String,
    ed25519_public_key: Vec<u8>,
}

fn migrate_legacy(legacy: LegacyPersistedData) -> PersistedData {
    let active_origin = legacy.active_url.map(|value| normalize_origin(&value));
    let now = now_rfc3339();
    let mut entries: Vec<StationEntry> = Vec::new();
    let mut active_station_peer_id = None;
    let mut pins = HashMap::new();
    for entry in legacy.entries {
        let Some(station_peer_id) = entry
            .peer_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let origin = normalize_origin(&entry.url);
        if origin.is_empty() {
            continue;
        }
        let route_id = legacy_route_id(&station_peer_id, &origin);
        let candidate = StationRouteCandidate {
            route_id: route_id.clone(),
            route_type: StationRouteType::Direct,
            transport: "direct_https".to_string(),
            endpoint_origin: origin.clone(),
            relay_peer_id: None,
            route_generation: 1,
            inner_tls_spki_sha256: None,
            attestation_bytes: None,
            connection_grant: None,
            attestation_expires_at_unix_ms: None,
            last_verified_at: entry.last_probe.clone().unwrap_or_else(|| now.clone()),
            last_success_at: entry
                .online
                .then(|| entry.last_probe.clone().unwrap_or_else(|| now.clone())),
            health: if entry.online {
                StationRouteHealth::Available
            } else {
                StationRouteHealth::Degraded
            },
        };
        if let Some(existing) = entries
            .iter_mut()
            .find(|existing| existing.station_peer_id == station_peer_id)
        {
            existing.routes.push(candidate);
            existing.updated_at = now.clone();
        } else {
            entries.push(StationEntry {
                station_peer_id: station_peer_id.clone(),
                display_name: entry.label,
                pinned_host_public_key: vec![0],
                routes: vec![candidate],
                active_route_id: route_id,
                route_revision: 1,
                lifecycle_generation: 1,
                created_at: now.clone(),
                updated_at: now.clone(),
            });
        }
        if active_origin.as_deref() == Some(origin.as_str()) {
            active_station_peer_id = Some(station_peer_id.clone());
        }
        if let Some(pin) = legacy.federation_signing_key_pins.get(&origin) {
            pins.insert(
                station_peer_id,
                PersistedFederationSigningKeyPin {
                    signing_key_id: pin.signing_key_id.clone(),
                    ed25519_public_key: pin.ed25519_public_key.clone(),
                },
            );
        }
    }
    PersistedData {
        version: REGISTRY_VERSION,
        entries,
        active_station_peer_id,
        federation_signing_key_pins: pins,
    }
}

fn route_candidate(route: &VerifiedStationRoute, now: &str) -> StationRouteCandidate {
    let route_type = if route.relay_peer_id.is_some() {
        StationRouteType::Relay
    } else {
        StationRouteType::Direct
    };
    StationRouteCandidate {
        route_id: route.route_id.clone(),
        route_type,
        transport: match route_type {
            StationRouteType::Direct => "direct_https",
            StationRouteType::Relay => "relay_wss_v1",
        }
        .to_string(),
        endpoint_origin: normalize_origin(&route.endpoint_origin),
        relay_peer_id: route.relay_peer_id.clone(),
        route_generation: route.route_generation,
        inner_tls_spki_sha256: route.inner_tls_spki_sha256.map(|value| value.to_vec()),
        attestation_bytes: route.attestation_bytes.clone(),
        connection_grant: route.connection_grant.clone(),
        attestation_expires_at_unix_ms: route.expires_at_unix_ms,
        last_verified_at: now.to_string(),
        last_success_at: Some(now.to_string()),
        health: StationRouteHealth::Available,
    }
}

fn legacy_route_id(station_peer_id: &str, origin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"peers-touch/direct-route/v1\0");
    hasher.update(station_peer_id.as_bytes());
    hasher.update([0]);
    hasher.update(origin.as_bytes());
    format!("direct-{}", hex::encode(hasher.finalize()))
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

fn normalize_origin(origin: &str) -> String {
    origin.trim().trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::station_discovery::VerifiedStationRoute;
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

    fn route(station: &str, id: &str, origin: &str, relay: bool) -> VerifiedStationRoute {
        VerifiedStationRoute {
            station_peer_id: station.to_string(),
            station_host_public_key: vec![1, 2, 3],
            route_id: id.to_string(),
            route_generation: 1,
            endpoint_origin: origin.to_string(),
            relay_peer_id: relay.then(|| "relay-peer".to_string()),
            inner_tls_spki_sha256: relay.then_some([7; 32]),
            attestation_bytes: relay.then(|| vec![8, 9]),
            connection_grant: None,
            expires_at_unix_ms: relay.then_some(i64::MAX),
        }
    }

    #[test]
    fn seed_is_discovery_input_not_an_identity_record() {
        with_seed(Some("https://seed.example/"), || {
            let registry = StationRegistry::new(&temp_dir("seed"));
            assert_eq!(
                registry.discovery_seed().as_deref(),
                Some("https://seed.example")
            );
            assert!(registry.list().is_empty());
            assert_eq!(registry.active_station_peer_id(), None);
        });
    }

    #[test]
    fn one_station_merges_direct_and_relay_routes() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("merge-routes"));
            registry
                .upsert_verified_route(
                    &route("station-one", "direct-1", "https://station.example", false),
                    Some("Home".to_string()),
                )
                .unwrap();
            registry
                .upsert_verified_route(
                    &route("station-one", "relay-1", "https://relay.example", true),
                    None,
                )
                .unwrap();

            let entries = registry.list();
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].station_peer_id, "station-one");
            assert_eq!(entries[0].routes.len(), 2);
        });
    }

    #[test]
    fn same_station_route_switch_only_increments_route_revision() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("route-switch"));
            registry
                .upsert_verified_route(
                    &route("station-one", "direct-1", "https://station.example", false),
                    None,
                )
                .unwrap();
            registry
                .upsert_verified_route(
                    &route("station-one", "relay-1", "https://relay.example", true),
                    None,
                )
                .unwrap();
            registry.set_active_station("station-one").unwrap();
            let before = registry.active_entry().unwrap();
            let after = registry.set_active_route("station-one", "relay-1").unwrap();

            assert_eq!(after.route_revision, before.route_revision + 1);
            assert_eq!(after.lifecycle_generation, before.lifecycle_generation);
            assert_eq!(
                registry.active_endpoint_origin().as_deref(),
                Some("https://relay.example")
            );
        });
    }

    #[test]
    fn station_switch_increments_lifecycle_generation() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("station-switch"));
            for station in ["station-one", "station-two"] {
                registry
                    .upsert_verified_route(
                        &route(
                            station,
                            &format!("{station}-route"),
                            &format!("https://{station}.example"),
                            false,
                        ),
                        None,
                    )
                    .unwrap();
            }
            registry.set_active_station("station-one").unwrap();
            let before = registry.entry("station-two").unwrap();
            let after = registry.set_active_station("station-two").unwrap();
            assert_eq!(after.lifecycle_generation, before.lifecycle_generation + 1);
        });
    }

    #[test]
    fn migrates_verified_legacy_entries_once() {
        with_seed(None, || {
            let dir = temp_dir("legacy");
            std::fs::write(
                dir.join("stations.json"),
                r#"{
                  "entries":[{
                    "url":"https://station.example/",
                    "label":"Home",
                    "peer_id":"station-one",
                    "peers_count":3,
                    "last_probe":"2026-10-07T00:00:00Z",
                    "online":true
                  }],
                  "active_url":"https://station.example"
                }"#,
            )
            .unwrap();
            let registry = StationRegistry::new(&dir);
            assert_eq!(
                registry.active_station_peer_id().as_deref(),
                Some("station-one")
            );
            assert_eq!(
                registry.active_endpoint_origin().as_deref(),
                Some("https://station.example")
            );
            let persisted = std::fs::read_to_string(dir.join("stations.json")).unwrap();
            assert!(persisted.contains("\"version\": 2"));
            assert!(!persisted.contains("\"active_url\""));
        });
    }

    #[test]
    fn rejects_station_host_key_replacement() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("host-key"));
            registry
                .upsert_verified_route(
                    &route("station-one", "direct-1", "https://station.example", false),
                    None,
                )
                .unwrap();
            let mut attacker = route("station-one", "relay-1", "https://relay.example", true);
            attacker.station_host_public_key = vec![9, 9, 9];
            assert_eq!(
                registry
                    .upsert_verified_route(&attacker, None)
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::PermissionDenied
            );
        });
    }
}
