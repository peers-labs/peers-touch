use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io;
use std::path::PathBuf;
use std::sync::RwLock;

use crate::infrastructure::station_discovery::VerifiedStationRoute;

const REGISTRY_VERSION: u32 = 3;

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
    pub node_peer_id: String,
    pub node_authorization_digest: Vec<u8>,
    pub authorization_epoch: u64,
    pub route_id: String,
    pub route_type: StationRouteType,
    pub transport: String,
    pub endpoint_origin: String,
    pub relay_peer_id: Option<String>,
    pub route_generation: u64,
    pub inner_tls_spki_sha256: Option<Vec<u8>>,
    pub addresses: Vec<String>,
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
    pub pinned_station_root_public_key: Vec<u8>,
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
        let state = Self::load(&persist_path);
        Self {
            state: RwLock::new(state),
            persist_path,
            discovery_seed,
        }
    }

    fn load(path: &std::path::Path) -> PersistedData {
        let Some(raw) = std::fs::read_to_string(path).ok() else {
            return PersistedData::default();
        };
        if let Ok(mut state) = serde_json::from_str::<PersistedData>(&raw) {
            if state.version != REGISTRY_VERSION {
                return PersistedData::default();
            }
            state.sanitize();
            return state;
        }
        PersistedData::default()
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
            || route.node_peer_id.trim().is_empty()
            || route.station_root_public_key.is_empty()
            || route.node_authorization_digest.len() != 32
            || route.authorization_epoch == 0
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
            if entry.pinned_station_root_public_key != route.station_root_public_key {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Station root identity changed without explicit replacement",
                ));
            }
            if let Some(existing) = entry
                .routes
                .iter_mut()
                .find(|existing| existing.route_id == candidate.route_id)
            {
                let active_contract_changed = entry.active_route_id == candidate.route_id
                    && !same_route_contract(existing, &candidate);
                *existing = candidate;
                if active_contract_changed {
                    entry.route_revision = entry.route_revision.saturating_add(1);
                }
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
                pinned_station_root_public_key: route.station_root_public_key.clone(),
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
        if !entry
            .active_route()
            .is_some_and(|route| route_attestation_is_current(route, unix_ms()))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Station has no current active verified route",
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
        ) || !route_attestation_is_current(route, unix_ms())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Station route is unavailable or expired",
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

    pub fn failover_route(
        &self,
        station_peer_id: &str,
        failed_route_id: &str,
        expected_route_revision: u64,
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
        if entry.route_revision != expected_route_revision
            || entry.active_route_id != failed_route_id
        {
            return Ok(entry.clone());
        }
        let failed_index = entry
            .routes
            .iter()
            .position(|route| route.route_id == failed_route_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Station route is unknown"))?;
        let failed_type = entry.routes[failed_index].route_type;
        entry.routes[failed_index].health = StationRouteHealth::Unavailable;
        entry.routes[failed_index].last_verified_at = now_rfc3339();

        let now_unix_ms = unix_ms();
        let mut candidates = entry
            .routes
            .iter()
            .filter(|route| {
                route.route_id != failed_route_id
                    && route.route_type == failed_type
                    && matches!(
                        route.health,
                        StationRouteHealth::Available | StationRouteHealth::Degraded
                    )
                    && route_attestation_is_current(route, now_unix_ms)
            })
            .map(|route| {
                (
                    u8::from(route.health != StationRouteHealth::Available),
                    route.route_id.clone(),
                )
            })
            .collect::<Vec<_>>();
        candidates.sort();
        entry.route_revision = entry.route_revision.saturating_add(1);
        let Some((_, next_route_id)) = candidates.into_iter().next() else {
            entry.updated_at = now_rfc3339();
            self.persist(&next)?;
            *state = next;
            return Err(io::Error::new(
                io::ErrorKind::NotConnected,
                "Station has no verified failover route",
            ));
        };
        entry.active_route_id = next_route_id;
        entry.updated_at = now_rfc3339();
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
                && !entry.pinned_station_root_public_key.is_empty()
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct PersistedFederationSigningKeyPin {
    signing_key_id: String,
    ed25519_public_key: Vec<u8>,
}

fn route_candidate(route: &VerifiedStationRoute, now: &str) -> StationRouteCandidate {
    let route_type = if route.relay_peer_id.is_some() {
        StationRouteType::Relay
    } else {
        StationRouteType::Direct
    };
    StationRouteCandidate {
        node_peer_id: route.node_peer_id.clone(),
        node_authorization_digest: route.node_authorization_digest.to_vec(),
        authorization_epoch: route.authorization_epoch,
        route_id: route.route_id.clone(),
        route_type,
        transport: match route_type {
            StationRouteType::Direct => "direct_https",
            StationRouteType::Relay => "libp2p_http_v1",
        }
        .to_string(),
        endpoint_origin: normalize_origin(&route.endpoint_origin),
        relay_peer_id: route.relay_peer_id.clone(),
        route_generation: route.route_generation,
        inner_tls_spki_sha256: route.inner_tls_spki_sha256.map(|value| value.to_vec()),
        addresses: route.addresses.clone(),
        attestation_bytes: route.attestation_bytes.clone(),
        connection_grant: route.connection_grant.clone(),
        attestation_expires_at_unix_ms: route.expires_at_unix_ms,
        last_verified_at: now.to_string(),
        last_success_at: Some(now.to_string()),
        health: StationRouteHealth::Available,
    }
}

fn same_route_contract(left: &StationRouteCandidate, right: &StationRouteCandidate) -> bool {
    left.node_peer_id == right.node_peer_id
        && left.node_authorization_digest == right.node_authorization_digest
        && left.authorization_epoch == right.authorization_epoch
        && left.route_id == right.route_id
        && left.route_type == right.route_type
        && left.transport == right.transport
        && left.endpoint_origin == right.endpoint_origin
        && left.relay_peer_id == right.relay_peer_id
        && left.route_generation == right.route_generation
        && left.inner_tls_spki_sha256 == right.inner_tls_spki_sha256
        && left.addresses == right.addresses
        && left.attestation_bytes == right.attestation_bytes
        && left.connection_grant == right.connection_grant
        && left.attestation_expires_at_unix_ms == right.attestation_expires_at_unix_ms
        && left.health == right.health
}

pub(crate) fn route_attestation_is_current(
    route: &StationRouteCandidate,
    now_unix_ms: i64,
) -> bool {
    route
        .attestation_expires_at_unix_ms
        .is_none_or(|expires_at| expires_at > now_unix_ms)
}

fn unix_ms() -> i64 {
    i64::try_from(time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000)
        .unwrap_or(i64::MAX)
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
            node_peer_id: format!("{station}-node"),
            station_root_public_key: vec![1, 2, 3],
            node_authorization_digest: [4; 32],
            authorization_epoch: 1,
            route_id: id.to_string(),
            route_generation: 1,
            endpoint_origin: origin.to_string(),
            relay_peer_id: relay.then(|| "relay-peer".to_string()),
            inner_tls_spki_sha256: relay.then_some([7; 32]),
            addresses: vec![origin.to_string()],
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
    fn route_failover_preserves_station_scope_and_fences_failed_route() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("route-failover"));
            registry
                .upsert_verified_route(
                    &route("station-one", "relay-a", "https://relay.example", true),
                    None,
                )
                .unwrap();
            let mut second = route("station-one", "relay-b", "https://relay.example", true);
            second.node_peer_id = "station-one-node-b".to_string();
            registry.upsert_verified_route(&second, None).unwrap();
            let before = registry.set_active_station("station-one").unwrap();

            let after = registry
                .failover_route("station-one", "relay-a", before.route_revision)
                .unwrap();

            assert_eq!(after.station_peer_id, before.station_peer_id);
            assert_eq!(after.lifecycle_generation, before.lifecycle_generation);
            assert_eq!(after.active_route_id, "relay-b");
            assert_eq!(after.route_revision, before.route_revision + 1);
            assert_eq!(
                after
                    .routes
                    .iter()
                    .find(|route| route.route_id == "relay-a")
                    .unwrap()
                    .health,
                StationRouteHealth::Unavailable
            );
        });
    }

    #[test]
    fn route_failover_persists_unavailable_without_a_replacement() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("route-exhausted"));
            registry
                .upsert_verified_route(
                    &route("station-one", "relay-a", "https://relay.example", true),
                    None,
                )
                .unwrap();
            let before = registry.set_active_station("station-one").unwrap();

            assert!(registry
                .failover_route("station-one", "relay-a", before.route_revision)
                .is_err());
            let after = registry.active_entry().unwrap();
            assert_eq!(after.routes[0].health, StationRouteHealth::Unavailable);
            assert_eq!(after.route_revision, before.route_revision + 1);
        });
    }

    #[test]
    fn route_failover_rejects_expired_or_stale_candidates() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("route-failover-cas"));
            registry
                .upsert_verified_route(
                    &route("station-one", "relay-a", "https://relay.example", true),
                    None,
                )
                .unwrap();
            let mut expired = route(
                "station-one",
                "relay-expired",
                "https://relay.example",
                true,
            );
            expired.node_peer_id = "station-one-node-expired".to_string();
            expired.expires_at_unix_ms = Some(unix_ms() - 1);
            registry.upsert_verified_route(&expired, None).unwrap();
            let before = registry.set_active_station("station-one").unwrap();

            assert!(registry
                .failover_route("station-one", "relay-a", before.route_revision)
                .is_err());

            let mut refreshed = route("station-one", "relay-a", "https://relay.example", true);
            refreshed.authorization_epoch = 2;
            let refreshed_entry = registry.upsert_verified_route(&refreshed, None).unwrap();
            let stale_result = registry
                .failover_route("station-one", "relay-a", before.route_revision)
                .unwrap();
            assert_eq!(stale_result.route_revision, refreshed_entry.route_revision);
            assert_eq!(
                stale_result
                    .routes
                    .iter()
                    .find(|route| route.route_id == "relay-a")
                    .unwrap()
                    .health,
                StationRouteHealth::Available
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
    fn rejects_pre_root_identity_registry_schema() {
        with_seed(None, || {
            let dir = temp_dir("stale-schema");
            std::fs::write(
                dir.join("stations.json"),
                r#"{
                  "version": 2,
                  "entries":[{
                    "station_peer_id":"station-one",
                    "pinned_host_public_key":[1],
                    "routes":[]
                  }],
                  "active_station_peer_id":"station-one"
                }"#,
            )
            .unwrap();
            let registry = StationRegistry::new(&dir);
            assert!(registry.list().is_empty());
            assert_eq!(registry.active_station_peer_id(), None);
        });
    }

    #[test]
    fn rejects_station_root_key_replacement() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("host-key"));
            registry
                .upsert_verified_route(
                    &route("station-one", "direct-1", "https://station.example", false),
                    None,
                )
                .unwrap();
            let mut attacker = route("station-one", "relay-1", "https://relay.example", true);
            attacker.station_root_public_key = vec![9, 9, 9];
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
