use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use prost::Message;
use std::sync::atomic::Ordering;

use super::client::{StationRequest, StationTransportError, StationTransportErrorKind};
use super::{
    binding_transport_error, commit_verified_route_refresh, current_unix_ms, route_policy_permits,
    RuntimeRequestExecutor,
};
use crate::infrastructure::station_discovery::{discover_station_input, VerifiedEndpoint};
use crate::infrastructure::station_registry::{
    StationEntry, StationRouteCandidate, StationRouteHealth, StationRouteType,
};
use crate::model::peer::{
    StationConnectionEnvelope, StationConnectionGrant, StationRouteAttestation,
};

const RENEWAL_LEAD_MS: i64 = 15_000;

impl RuntimeRequestExecutor {
    pub(super) fn renew_route_before_submission(
        &self,
        request: &StationRequest,
    ) -> Result<(), StationTransportError> {
        self.renew_route_with(request, |_entry, route| {
            let input = renewal_input(route)?;
            discover_station_input(&input, |scope, message| {
                self.transport
                    .sign_identity_proof(scope, message)
                    .map(|proof| (proof.public_key, proof.signature))
                    .map_err(|error| error.to_string())
            })
            .map_err(|error| renewal_error(error.message))
        })
    }

    pub(super) fn renew_route_with(
        &self,
        request: &StationRequest,
        discover: impl FnOnce(
            &StationEntry,
            &StationRouteCandidate,
        ) -> Result<VerifiedEndpoint, StationTransportError>,
    ) -> Result<(), StationTransportError> {
        let Some(entry) = self.binding.committed_entry() else {
            return Ok(());
        };
        if !renewal_due(&entry, request) {
            return Ok(());
        }
        let _transition = self
            .transition
            .lock()
            .map_err(|_| renewal_error("Station transition lock unavailable"))?;
        self.ensure_renewal_scope(request)?;
        let entry = self
            .binding
            .committed_entry()
            .ok_or_else(|| renewal_error("Station binding no longer has a route"))?;
        if !renewal_due(&entry, request) {
            return Ok(());
        }
        let route = entry
            .active_route()
            .ok_or_else(|| renewal_error("Station binding no longer has a route"))?;
        let endpoint = validate_renewal(&entry, route, discover(&entry, route)?)?;
        self.ensure_renewal_scope(request)?;
        commit_verified_route_refresh(
            &self.registry,
            &self.binding,
            &self.transport,
            &endpoint.routes,
        )
        .map_err(binding_transport_error)?;
        Ok(())
    }

    fn ensure_renewal_scope(&self, request: &StationRequest) -> Result<(), StationTransportError> {
        if self.stopped.load(Ordering::Acquire) || request.cancellation.is_cancelled() {
            return Err(StationTransportError::new(
                StationTransportErrorKind::Cancelled,
                "Station route renewal was cancelled before submission",
                false,
            ));
        }
        if request
            .expected_scope
            .as_ref()
            .is_none_or(|scope| !self.scope_matches(scope))
        {
            return Err(StationTransportError::new(
                StationTransportErrorKind::StaleRoute,
                "Station route renewal belongs to a stale lifecycle",
                false,
            ));
        }
        Ok(())
    }
}

fn renewal_due(entry: &StationEntry, request: &StationRequest) -> bool {
    entry.active_route().is_some_and(|route| {
        route.health != StationRouteHealth::Revoked
            && route_policy_permits(request.route_policy, route.route_type)
            && request.route_security.permits(&route.endpoint_origin)
            && route
                .attestation_expires_at_unix_ms
                .is_some_and(|expiry| expiry <= current_unix_ms().saturating_add(RENEWAL_LEAD_MS))
    })
}

fn renewal_input(route: &StationRouteCandidate) -> Result<String, StationTransportError> {
    let (StationRouteType::Relay, Some(grant)) =
        (route.route_type, route.connection_grant.as_deref())
    else {
        return Ok(route.endpoint_origin.clone());
    };
    let connection_grant = StationConnectionGrant::decode(grant)
        .map_err(|_| renewal_error("Stored Station connection grant is invalid"))?;
    let route_attestation =
        StationRouteAttestation::decode(route.attestation_bytes.as_deref().unwrap_or_default())
            .map_err(|_| renewal_error("Stored Station route attestation is invalid"))?;
    let envelope = StationConnectionEnvelope {
        protocol_version: 1,
        relay_origin: route.endpoint_origin.clone(),
        route_attestation: Some(route_attestation),
        connection_grant: Some(connection_grant),
    };
    Ok(format!(
        "ptc1:{}",
        URL_SAFE_NO_PAD.encode(envelope.encode_to_vec())
    ))
}

fn validate_renewal(
    entry: &StationEntry,
    route: &StationRouteCandidate,
    mut endpoint: VerifiedEndpoint,
) -> Result<VerifiedEndpoint, StationTransportError> {
    if !endpoint.routes.iter().any(|candidate| {
        candidate.station_peer_id == entry.station_peer_id
            && candidate.station_root_public_key == entry.pinned_station_root_public_key
            && candidate.route_id == route.route_id
            && candidate.node_peer_id == route.node_peer_id
            && candidate.authorization_epoch >= route.authorization_epoch
            && candidate.route_generation >= route.route_generation
    }) {
        return Err(StationTransportError::new(
            StationTransportErrorKind::InvalidRoute,
            "Refreshed endpoint does not retain the pinned Station route",
            false,
        ));
    }
    endpoint
        .routes
        .retain(|candidate| candidate.station_peer_id == entry.station_peer_id);
    Ok(endpoint)
}

fn renewal_error(message: impl Into<String>) -> StationTransportError {
    StationTransportError::new(StationTransportErrorKind::NoRoute, message, false)
}
