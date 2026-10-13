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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    candidate_route_refreshes: Vec<StationRouteCandidate>,
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

    pub(crate) fn verified_candidate(&self, route_id: &str) -> Option<&StationRouteCandidate> {
        self.candidate_route_refreshes
            .iter()
            .find(|route| route.route_id == route_id)
            .or_else(|| self.routes.iter().find(|route| route.route_id == route_id))
    }

    pub(crate) fn selected_candidate(&self) -> Option<&StationRouteCandidate> {
        self.verified_candidate(&self.active_route_id)
    }

    pub(crate) fn selection_view(&self, route_id: &str) -> Option<Self> {
        let selected = self.verified_candidate(route_id)?.clone();
        let mut selection = self.clone();
        if let Some(route) = selection
            .routes
            .iter_mut()
            .find(|route| route.route_id == route_id)
        {
            *route = selected;
        } else {
            selection.routes.push(selected);
        }
        selection
            .candidate_route_refreshes
            .retain(|route| route.route_id != route_id);
        selection.active_route_id = route_id.to_string();
        Some(selection)
    }

    pub(crate) fn has_same_active_contract(&self, other: &Self) -> bool {
        self.active_route()
            .zip(other.active_route())
            .is_some_and(|(left, right)| same_route_contract(left, right))
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
        validate_verified_route(route)?;
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
            let highest_authorization_epoch = entry
                .routes
                .iter()
                .filter(|existing| existing.node_peer_id == candidate.node_peer_id)
                .map(|existing| existing.authorization_epoch)
                .max()
                .unwrap_or(0);
            if candidate.authorization_epoch < highest_authorization_epoch {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Station route uses a stale node authorization epoch",
                ));
            }
            let mut revision_changed = false;
            if let Some(existing) = entry
                .routes
                .iter_mut()
                .find(|existing| existing.route_id == candidate.route_id)
            {
                let active_contract_changed = entry.active_route_id == candidate.route_id
                    && !same_route_contract(existing, &candidate);
                *existing = candidate.clone();
                if active_contract_changed {
                    entry.route_revision = entry.route_revision.saturating_add(1);
                    revision_changed = true;
                }
            } else {
                entry.routes.push(candidate.clone());
            }
            for existing in &mut entry.routes {
                if existing.node_peer_id == candidate.node_peer_id
                    && existing.authorization_epoch < candidate.authorization_epoch
                {
                    existing.health = StationRouteHealth::Revoked;
                }
            }
            if entry.active_route_id.is_empty() {
                entry.active_route_id = route.route_id.clone();
            } else if entry
                .active_route()
                .is_some_and(|active| active.health == StationRouteHealth::Revoked)
            {
                if entry.active_route_id != candidate.route_id {
                    entry.active_route_id = candidate.route_id.clone();
                    if !revision_changed {
                        entry.route_revision = entry.route_revision.saturating_add(1);
                    }
                }
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
                candidate_route_refreshes: Vec::new(),
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

    pub fn replace_verified_routes(
        &self,
        routes: &[VerifiedStationRoute],
    ) -> io::Result<Vec<StationEntry>> {
        if routes.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Verified Station route set is empty",
            ));
        }
        for route in routes {
            validate_verified_route(route)?;
        }

        let mut grouped: HashMap<&str, Vec<&VerifiedStationRoute>> = HashMap::new();
        for route in routes {
            grouped
                .entry(route.station_peer_id.as_str())
                .or_default()
                .push(route);
        }
        let mut station_ids = grouped.keys().copied().collect::<Vec<_>>();
        station_ids.sort_unstable();

        let now = now_rfc3339();
        let now_unix_ms = unix_ms();
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        let mut next = state.clone();
        let mut replaced = Vec::with_capacity(station_ids.len());

        for station_peer_id in station_ids {
            let verified = grouped
                .get(station_peer_id)
                .expect("grouped Station routes must exist");
            let station_root_public_key = &verified[0].station_root_public_key;
            if verified
                .iter()
                .any(|route| route.station_root_public_key != *station_root_public_key)
            {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Verified routes disagree on Station root identity",
                ));
            }
            let mut route_ids = HashSet::new();
            if verified
                .iter()
                .any(|route| !route_ids.insert(route.route_id.as_str()))
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Verified Station route set contains duplicate route IDs",
                ));
            }

            let mut candidates = verified
                .iter()
                .map(|route| route_candidate(route, &now))
                .collect::<Vec<_>>();
            let refreshed_nodes = candidates
                .iter()
                .map(|candidate| candidate.node_peer_id.clone())
                .collect::<HashSet<_>>();

            if let Some(entry) = next
                .entries
                .iter_mut()
                .find(|entry| entry.station_peer_id == station_peer_id)
            {
                if entry.pinned_station_root_public_key != *station_root_public_key {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "Station root identity changed without explicit replacement",
                    ));
                }
                for candidate in &candidates {
                    let persisted_epoch = entry
                        .routes
                        .iter()
                        .chain(entry.candidate_route_refreshes.iter())
                        .filter(|route| route.node_peer_id == candidate.node_peer_id)
                        .map(|route| route.authorization_epoch)
                        .max()
                        .unwrap_or(0);
                    if candidate.authorization_epoch < persisted_epoch {
                        return Err(io::Error::new(
                            io::ErrorKind::PermissionDenied,
                            "Station route set rolls back a node authorization epoch",
                        ));
                    }
                }

                let previous_active = entry.active_route().cloned().ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        "Station has no committed active route",
                    )
                })?;
                let refreshed_active_contract = candidates
                    .iter()
                    .position(|candidate| candidate.route_id == previous_active.route_id)
                    .map(|index| candidates.remove(index))
                    .filter(|candidate| !same_route_contract(candidate, &previous_active));
                let retained_active_refresh = refreshed_active_contract.or_else(|| {
                    entry
                        .candidate_route_refreshes
                        .iter()
                        .find(|candidate| {
                            candidate.route_id == previous_active.route_id
                                && !refreshed_nodes.contains(&candidate.node_peer_id)
                        })
                        .cloned()
                });
                candidates.extend(
                    entry
                        .routes
                        .iter()
                        .filter(|route| {
                            route.route_id != previous_active.route_id
                                && !refreshed_nodes.contains(&route.node_peer_id)
                        })
                        .cloned(),
                );
                candidates.retain(|candidate| candidate.route_id != previous_active.route_id);
                mark_stale_authorizations_revoked(&mut candidates);
                candidates.push(previous_active);
                entry.routes = candidates;
                entry.candidate_route_refreshes = retained_active_refresh.into_iter().collect();
                entry.updated_at = now.clone();
                replaced.push(entry.clone());
            } else {
                mark_stale_authorizations_revoked(&mut candidates);
                let selected_route_id = select_preferred_route(&candidates, now_unix_ms)
                    .map(|candidate| candidate.route_id.clone())
                    .ok_or_else(|| {
                        io::Error::new(
                            io::ErrorKind::InvalidData,
                            "Station has no current verified route",
                        )
                    })?;
                let entry = StationEntry {
                    station_peer_id: station_peer_id.to_string(),
                    display_name: None,
                    pinned_station_root_public_key: station_root_public_key.clone(),
                    routes: candidates,
                    candidate_route_refreshes: Vec::new(),
                    active_route_id: selected_route_id,
                    route_revision: 1,
                    lifecycle_generation: 1,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                };
                replaced.push(entry.clone());
                next.entries.push(entry);
            }
        }

        self.persist(&next)?;
        *state = next;
        Ok(replaced)
    }

    /// Persist one verified selection atomically. Candidate preparation never
    /// changes the active registry entry.
    pub(crate) fn commit_selection(
        &self,
        candidate: &StationEntry,
        failed_route_id: Option<&str>,
    ) -> io::Result<StationEntry> {
        let mut state = self
            .state
            .write()
            .expect("StationRegistry write lock poisoned");
        let mut next = state.clone();
        let changing_station =
            next.active_station_peer_id.as_deref() != Some(candidate.station_peer_id.as_str());
        let entry = next
            .entries
            .iter_mut()
            .find(|entry| entry.station_peer_id == candidate.station_peer_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Station is not registered"))?;
        if entry.route_revision != candidate.route_revision
            || entry.lifecycle_generation != candidate.lifecycle_generation
            || entry.pinned_station_root_public_key != candidate.pinned_station_root_public_key
        {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "Station candidate changed during verification",
            ));
        }
        let selected = entry
            .verified_candidate(&candidate.active_route_id)
            .filter(|route| {
                candidate
                    .selected_candidate()
                    .is_some_and(|verified| same_route_contract(route, verified))
                    && route_is_selectable_in_entry(route, entry, unix_ms())
            })
            .cloned()
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Verified Station route changed or expired",
                )
            })?;
        let selected_id = selected.route_id.clone();
        if let Some(failed) = failed_route_id {
            for route in entry
                .routes
                .iter_mut()
                .chain(entry.candidate_route_refreshes.iter_mut())
                .filter(|route| route.route_id == failed)
            {
                route.health = StationRouteHealth::Unavailable;
            }
        }
        let contract_changed = entry
            .active_route()
            .is_none_or(|active| !same_route_contract(active, &selected));
        if let Some(route) = entry
            .routes
            .iter_mut()
            .find(|route| route.route_id == selected_id)
        {
            *route = selected;
        } else {
            entry.routes.push(selected);
        }
        entry.candidate_route_refreshes.clear();
        mark_stale_authorizations_revoked(&mut entry.routes);
        if entry.active_route_id != selected_id || failed_route_id.is_some() || contract_changed {
            entry.active_route_id = selected_id;
            entry.route_revision = entry.route_revision.saturating_add(1);
        }
        if changing_station && next.active_station_peer_id.is_some() {
            entry.lifecycle_generation = entry.lifecycle_generation.saturating_add(1);
        }
        entry.updated_at = now_rfc3339();
        let selected = entry.clone();
        next.active_station_peer_id = Some(candidate.station_peer_id.clone());
        self.persist(&next)?;
        *state = next;
        Ok(selected)
    }

    pub(crate) fn failover_candidate(
        &self,
        station_peer_id: &str,
        failed_route_id: &str,
    ) -> io::Result<StationEntry> {
        let mut entry = self
            .entry(station_peer_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Station is not registered"))?;
        let selected = entry
            .routes
            .iter()
            .filter(|route| {
                route.route_id != failed_route_id
                    && route_is_selectable(route, &entry.routes, unix_ms())
            })
            .min_by_key(|route| {
                (
                    u8::from(route.health != StationRouteHealth::Available),
                    &route.route_id,
                )
            })
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotConnected,
                    "Station has no verified failover route",
                )
            })?;
        entry.active_route_id = selected.route_id.clone();
        Ok(entry)
    }

    #[cfg(test)]
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

    #[cfg(test)]
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

    #[cfg(test)]
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
        entry.routes[failed_index].health = StationRouteHealth::Unavailable;
        entry.routes[failed_index].last_verified_at = now_rfc3339();

        let now_unix_ms = unix_ms();
        let mut candidates = entry
            .routes
            .iter()
            .filter(|route| {
                route.route_id != failed_route_id
                    && matches!(
                        route.health,
                        StationRouteHealth::Available | StationRouteHealth::Degraded
                    )
                    && route_is_selectable(route, &entry.routes, now_unix_ms)
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
            entry
                .candidate_route_refreshes
                .iter_mut()
                .for_each(|route| {
                    route.endpoint_origin = normalize_origin(&route.endpoint_origin);
                });
            let mut route_ids = HashSet::new();
            entry.routes.retain(|route| {
                !route.route_id.trim().is_empty()
                    && !route.endpoint_origin.is_empty()
                    && route_ids.insert(route.route_id.clone())
            });
            let active_route = entry.active_route().cloned();
            let mut refresh_ids = HashSet::new();
            entry.candidate_route_refreshes.retain(|route| {
                !route.route_id.trim().is_empty()
                    && !route.endpoint_origin.is_empty()
                    && route.route_id == entry.active_route_id
                    && refresh_ids.insert(route.route_id.clone())
                    && active_route
                        .as_ref()
                        .is_some_and(|active| !same_route_contract(active, route))
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

fn validate_verified_route(route: &VerifiedStationRoute) -> io::Result<()> {
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
    Ok(())
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

fn mark_stale_authorizations_revoked(routes: &mut [StationRouteCandidate]) {
    let mut highest_epoch_by_node = HashMap::new();
    for route in routes.iter() {
        highest_epoch_by_node
            .entry(route.node_peer_id.clone())
            .and_modify(|epoch: &mut u64| *epoch = (*epoch).max(route.authorization_epoch))
            .or_insert(route.authorization_epoch);
    }
    for route in routes.iter_mut() {
        if highest_epoch_by_node
            .get(&route.node_peer_id)
            .is_some_and(|epoch| route.authorization_epoch < *epoch)
        {
            route.health = StationRouteHealth::Revoked;
        }
    }
}

fn route_is_selectable(
    route: &StationRouteCandidate,
    routes: &[StationRouteCandidate],
    now_unix_ms: i64,
) -> bool {
    !matches!(
        route.health,
        StationRouteHealth::Unavailable | StationRouteHealth::Revoked
    ) && route_attestation_is_current(route, now_unix_ms)
        && !routes.iter().any(|candidate| {
            candidate.node_peer_id == route.node_peer_id
                && candidate.authorization_epoch > route.authorization_epoch
        })
}

fn route_is_selectable_in_entry(
    route: &StationRouteCandidate,
    entry: &StationEntry,
    now_unix_ms: i64,
) -> bool {
    !matches!(
        route.health,
        StationRouteHealth::Unavailable | StationRouteHealth::Revoked
    ) && route_attestation_is_current(route, now_unix_ms)
        && !entry
            .routes
            .iter()
            .chain(entry.candidate_route_refreshes.iter())
            .any(|candidate| {
                candidate.node_peer_id == route.node_peer_id
                    && candidate.authorization_epoch > route.authorization_epoch
            })
}

fn select_preferred_route(
    routes: &[StationRouteCandidate],
    now_unix_ms: i64,
) -> Option<&StationRouteCandidate> {
    let mut candidates = routes
        .iter()
        .filter(|route| route_is_selectable(route, routes, now_unix_ms))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|route| {
        (
            u8::from(route.health != StationRouteHealth::Available),
            u8::from(route.route_type != StationRouteType::Direct),
            route.route_id.as_str(),
        )
    });
    candidates.into_iter().next()
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
    fn route_failover_can_switch_between_transport_types() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("cross-transport-failover"));
            registry
                .upsert_verified_route(
                    &route("station-one", "direct-a", "https://station.example", false),
                    None,
                )
                .unwrap();
            let mut relay = route("station-one", "relay-b", "https://relay.example", true);
            relay.node_peer_id = "station-one-node-b".to_string();
            registry.upsert_verified_route(&relay, None).unwrap();
            let before = registry.set_active_station("station-one").unwrap();

            let after = registry
                .failover_route("station-one", "direct-a", before.route_revision)
                .unwrap();

            assert_eq!(after.active_route_id, "relay-b");
            assert_eq!(
                after.active_route().unwrap().route_type,
                StationRouteType::Relay
            );
        });
    }

    #[test]
    fn authoritative_route_refresh_removes_omitted_routes() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("replace-routes"));
            let direct = route("station-one", "direct-a", "https://station.example", false);
            let relay = route("station-one", "relay-b", "https://relay.example", true);
            registry
                .replace_verified_routes(&[direct.clone(), relay])
                .unwrap();

            let entries = registry
                .replace_verified_routes(std::slice::from_ref(&direct))
                .unwrap();

            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].routes.len(), 1);
            assert_eq!(entries[0].routes[0].route_id, "direct-a");
        });
    }

    #[test]
    fn authoritative_route_refresh_preserves_sibling_node_routes() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("preserve-sibling-node"));
            let node_a = route("station-one", "direct-a", "https://node-a.example", false);
            let mut node_b = route("station-one", "direct-b", "https://node-b.example", false);
            node_b.node_peer_id = "station-one-node-b".to_string();
            registry
                .replace_verified_routes(&[node_a.clone(), node_b.clone()])
                .unwrap();

            let entries = registry
                .replace_verified_routes(std::slice::from_ref(&node_b))
                .unwrap();

            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].routes.len(), 2);
            assert!(entries[0]
                .routes
                .iter()
                .any(|route| route.route_id == node_a.route_id));
            assert!(entries[0]
                .routes
                .iter()
                .any(|route| route.route_id == node_b.route_id));
        });
    }

    #[test]
    fn candidate_refresh_preserves_committed_route_until_selection() {
        with_seed(None, || {
            let config_dir = temp_dir("candidate-preserves-commit");
            let registry = StationRegistry::new(&config_dir);
            let current = route(
                "station-one",
                "direct-current",
                "https://current.example",
                false,
            );
            registry
                .replace_verified_routes(std::slice::from_ref(&current))
                .unwrap();
            let before = registry.set_active_station("station-one").unwrap();

            let mut candidate = route(
                "station-one",
                "direct-candidate",
                "https://candidate.example",
                false,
            );
            candidate.authorization_epoch = 2;
            let refreshed = registry
                .replace_verified_routes(std::slice::from_ref(&candidate))
                .unwrap()
                .remove(0);

            assert_eq!(refreshed.active_route_id, before.active_route_id);
            assert_eq!(refreshed.route_revision, before.route_revision);
            assert_eq!(
                refreshed.active_route().unwrap().endpoint_origin,
                before.active_route().unwrap().endpoint_origin
            );
            assert_eq!(
                registry.active_entry().unwrap().active_route_id,
                before.active_route_id
            );

            drop(registry);
            let restarted = StationRegistry::new(&config_dir);
            let restored = restarted.active_entry().unwrap();
            assert_eq!(restored.active_route_id, before.active_route_id);
            assert_eq!(restored.route_revision, before.route_revision);
            assert_eq!(
                restored.active_route().unwrap().endpoint_origin,
                before.active_route().unwrap().endpoint_origin
            );
        });
    }

    #[test]
    fn same_route_id_refresh_preserves_new_contract_until_selection() {
        with_seed(None, || {
            let config_dir = temp_dir("same-id-candidate-preserves-contract");
            let registry = StationRegistry::new(&config_dir);
            let current = route(
                "station-one",
                "direct-current",
                "https://current.example",
                false,
            );
            registry
                .replace_verified_routes(std::slice::from_ref(&current))
                .unwrap();
            let before = registry.set_active_station("station-one").unwrap();

            let mut refreshed_contract = current;
            refreshed_contract.authorization_epoch = 2;
            refreshed_contract.node_authorization_digest = [9; 32];
            refreshed_contract.expires_at_unix_ms = Some(i64::MAX);
            let refreshed = registry
                .replace_verified_routes(std::slice::from_ref(&refreshed_contract))
                .unwrap()
                .remove(0);

            assert_eq!(refreshed.route_revision, before.route_revision);
            assert_eq!(
                refreshed.active_route().unwrap().authorization_epoch,
                before.active_route().unwrap().authorization_epoch
            );
            let candidate = refreshed
                .verified_candidate("direct-current")
                .expect("refreshed same-ID route must remain selectable");
            assert_eq!(candidate.authorization_epoch, 2);
            assert_eq!(candidate.node_authorization_digest, vec![9; 32]);
            assert_eq!(candidate.attestation_expires_at_unix_ms, Some(i64::MAX));

            drop(registry);
            let restarted = StationRegistry::new(&config_dir);
            let restored = restarted.active_entry().unwrap();
            assert_eq!(restored.route_revision, before.route_revision);
            assert_eq!(
                restored.active_route().unwrap().authorization_epoch,
                before.active_route().unwrap().authorization_epoch
            );
            assert_eq!(
                restored
                    .verified_candidate("direct-current")
                    .unwrap()
                    .authorization_epoch,
                2
            );

            let committed = restarted.commit_selection(&restored, None).unwrap();
            assert_eq!(committed.active_route().unwrap().authorization_epoch, 2);
            assert_eq!(committed.route_revision, before.route_revision + 1);
        });
    }

    #[test]
    fn route_refresh_rejects_authorization_epoch_rollback() {
        with_seed(None, || {
            let registry = StationRegistry::new(&temp_dir("authorization-rollback"));
            let mut current = route("station-one", "direct-a", "https://station.example", false);
            current.authorization_epoch = 2;
            registry
                .replace_verified_routes(std::slice::from_ref(&current))
                .unwrap();

            let mut stale = current;
            stale.authorization_epoch = 1;
            assert_eq!(
                registry
                    .replace_verified_routes(std::slice::from_ref(&stale))
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::PermissionDenied
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
