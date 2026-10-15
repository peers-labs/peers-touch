use crate::infrastructure::station_registry::{StationEntry, StationRouteCandidate};
use std::fmt;
use tokio_util::sync::CancellationToken;

use super::client::TrafficClass;

#[derive(Clone)]
pub struct RouteLease {
    pub station_peer_id: String,
    pub lifecycle_generation: u64,
    pub route_id: String,
    pub route_revision: u64,
    pub route_generation: u64,
    pub route: StationRouteCandidate,
    pub traffic_class: TrafficClass,
    cancellation: CancellationToken,
}

impl fmt::Debug for RouteLease {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RouteLease")
            .field("station_peer_id", &self.station_peer_id)
            .field("lifecycle_generation", &self.lifecycle_generation)
            .field("route_id", &self.route_id)
            .field("route_revision", &self.route_revision)
            .field("route_generation", &self.route_generation)
            .field("traffic_class", &self.traffic_class)
            .finish_non_exhaustive()
    }
}

impl RouteLease {
    pub(crate) fn from_entry(
        entry: &StationEntry,
        traffic_class: TrafficClass,
        cancellation: CancellationToken,
    ) -> Option<Self> {
        let route = entry.active_route()?.clone();
        Some(Self {
            station_peer_id: entry.station_peer_id.clone(),
            lifecycle_generation: entry.lifecycle_generation,
            route_id: route.route_id.clone(),
            route_revision: entry.route_revision,
            route_generation: route.route_generation,
            route,
            traffic_class,
            cancellation,
        })
    }

    pub fn cancellation(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }
}
