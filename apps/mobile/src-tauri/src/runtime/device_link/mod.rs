//! One native, restartable Device Link attempt per installation. Only redacted
//! projections cross Tauri; the existing OAuth owner commits the Session.
mod actions;
mod delivery;
mod intake;
mod projection;
mod protocol;
pub use projection::Projection;

use device_link_core::{canonical, offer, proto::*, transcript};
use prost::Message;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use zeroize::{Zeroize, Zeroizing};

use crate::{
    error::{MobileError, MobileResult},
    platform::secure_storage::SecureStorage,
    runtime::{
        oauth::{self, link_session, OAuthCoordinator, OAuthScopeIntent, SecretStore},
        station_route,
    },
};

const RECORD: &str = "peers-touch.mobile.device-link.active";

pub(crate) fn error(code: &str) -> MobileError {
    MobileError::coded("MOBILE_DEVICE_LINK", format!("deviceLink.{code}"))
}
fn core<T>(result: Result<T, device_link_core::Error>) -> MobileResult<T> {
    result.map_err(|e| error(e.0))
}

#[derive(Serialize, Deserialize)]
#[cfg_attr(test, derive(Default))]
pub(super) struct Flow {
    offer_bytes: Vec<u8>,
    offer_id: String,
    station_peer_id: String,
    station_root: Vec<u8>,
    actor_ptid: String,
    device_id: String,
    auth_generation: u64,
    receiver_seed: [u8; 32],
    device_seed: [u8; 32],
    claim_request: Vec<u8>,
    claim_id: String,
    claim_bytes: Vec<u8>,
    claim_capability: Vec<u8>,
    comparison_transcript: Vec<u8>,
    identity_seed: Vec<u8>,
    canonical_origin: String,
    status_bytes: Vec<u8>,
    delivery_id: String,
    credential_digest: Vec<u8>,
    session_id: String,
    committed: bool,
    #[serde(default)]
    proved_profile: u64,
    #[serde(default)]
    session: Option<oauth::NativeSessionProjection>,
    previous_route: Option<station_route::StationRouteBindingProjection>,
    linked_route: Option<station_route::StationRouteBindingProjection>,
    #[serde(default)]
    route_source_ref: String,
    #[serde(default)]
    route_transition_candidates: Vec<Vec<u8>>,
    #[serde(default)]
    route_candidates: Vec<Vec<u8>>,
    #[serde(default)]
    cancel_requested: bool,
}

impl Drop for Flow {
    fn drop(&mut self) {
        self.offer_bytes.zeroize();
        self.receiver_seed.zeroize();
        self.device_seed.zeroize();
        self.claim_request.zeroize();
        self.claim_capability.zeroize();
        self.identity_seed.zeroize();
        self.route_transition_candidates
            .iter_mut()
            .for_each(Zeroize::zeroize);
        self.route_candidates.iter_mut().for_each(Zeroize::zeroize);
    }
}

impl Flow {
    fn offer(&self) -> MobileResult<offer::VerifiedOffer> {
        core(offer::verify(
            &core(canonical(&self.offer_bytes))?,
            &self.station_peer_id,
            &self.station_root,
            device_link_core::bootstrap::unix_ms(),
        ))
    }
    fn actor_scope(&self) -> String {
        format!("{}|{}", self.station_peer_id, self.actor_ptid)
    }
    fn scope(&self) -> OAuthScopeIntent {
        OAuthScopeIntent {
            station_origin: self.canonical_origin.clone(),
            station_peer_id: self.station_peer_id.clone(),
        }
    }
}

#[derive(Default)]
pub struct MobileDeviceLinkRuntime {
    operation: Mutex<()>,
    epoch: AtomicU64,
    scanning: std::sync::atomic::AtomicBool,
}

impl MobileDeviceLinkRuntime {
    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }
    pub fn begin_scan(&self) -> MobileResult<u64> {
        self.scanning
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| error("busy"))?;
        Ok(self.epoch())
    }
    pub fn end_scan(&self) {
        self.scanning.store(false, Ordering::Release);
    }
    pub fn invalidate(&self) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
    }
    fn save<S: SecretStore>(&self, storage: &S, flow: &Flow, epoch: u64) -> MobileResult<()> {
        if self.epoch.load(Ordering::Acquire) != epoch {
            return Err(error("cancelled"));
        }
        let encoded =
            Zeroizing::new(serde_json::to_string(flow).map_err(|_| error("persistenceFailed"))?);
        storage.set_secret(RECORD, &encoded)?;
        let recovered = Zeroizing::new(
            storage
                .get_secret(RECORD)?
                .ok_or_else(|| error("persistenceFailed"))?,
        );
        if *recovered != *encoded {
            return Err(error("persistenceFailed"));
        }
        Ok(())
    }
    fn load<S: SecretStore>(storage: &S) -> MobileResult<Option<Flow>> {
        storage
            .get_secret(RECORD)?
            .map(|s| {
                let encoded = Zeroizing::new(s);
                serde_json::from_str(&encoded).map_err(|_| error("persistenceFailed"))
            })
            .transpose()
    }
    fn fence<S: SecretStore>(&self, storage: &S, flow: &Flow, epoch: u64) -> MobileResult<()> {
        if self.epoch.load(Ordering::Acquire) != epoch {
            return Err(error("cancelled"));
        }
        let identity = oauth::load_or_create_identity(storage)?;
        if identity.device_id != flow.device_id || identity.generation != flow.auth_generation {
            return Err(error("sessionScopeChanged"));
        }
        Ok(())
    }

    // Cleanup retains the original request's identity after logout. It never
    // rebinds the attempt to a new generation or grants Session installation.
    fn cleanup_fence<S: SecretStore>(&self, storage: &S, flow: &Flow, epoch: u64) -> MobileResult<()> {
        if self.epoch.load(Ordering::Acquire) != epoch {
            return Err(error("cancelled"));
        }
        let identity = oauth::load_or_create_identity(storage)?;
        if !flow.cancel_requested
            || flow.committed
            || identity.device_id != flow.device_id
            || identity.generation < flow.auth_generation
        {
            return Err(error("sessionScopeChanged"));
        }
        Ok(())
    }

    pub fn poll(
        &self,
        storage: &SecureStorage,
        oauth: &OAuthCoordinator,
    ) -> MobileResult<Projection> {
        let _single = self.operation.try_lock().map_err(|_| error("busy"))?;
        let _auth = oauth.begin_operation()?;
        let epoch = self.epoch.load(Ordering::Acquire);
        let Some(mut flow) = Self::load(storage)? else {
            return Ok(Projection::idle());
        };
        let result = self.drive(storage, &mut flow, epoch);
        if result.as_ref().is_err_and(|error| {
            error.message == "deviceLink.transportFailed"
                || error.message == "mobile.launch.stationIdentityInvalid:endpointUnavailable"
        }) {
            self.recover_route(storage, &mut flow, epoch)?;
            // Mutations are reconciled by the next status/immutable claim
            // replay, never resubmitted automatically by the transport.
            return Err(error("routeRecovered"));
        }
        result
    }

    fn drive(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        epoch: u64,
    ) -> MobileResult<Projection> {
        if flow.cancel_requested && Self::expired_without_delivery(&flow)? {
            return self.finish_expired(storage, &flow);
        }
        if flow.cancel_requested {
            self.restore_route(storage, flow, epoch)?;
            return self.cancel_inner(storage, flow, epoch);
        }
        self.fence(storage, &flow, epoch)?;
        self.restore_route(storage, flow, epoch)?;
        if flow.committed {
            flow.session = link_session::current(storage, flow.scope())?;
            if flow.session.is_none() {
                storage.remove(RECORD)?;
                return Ok(Projection::idle());
            }
            self.save(storage, &flow, epoch)?;
            return projection::project(&flow);
        }
        self.claim(storage, flow, epoch)?;
        self.poll_inner(storage, flow, epoch)
    }

    fn recover_route(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        epoch: u64,
    ) -> MobileResult<()> {
        if flow.cancel_requested {
            self.cleanup_fence(storage, flow, epoch)?;
        } else {
            self.fence(storage, flow, epoch)?;
        }
        let current =
            station_route::station_route_snapshot()?.ok_or_else(|| error("stationUnreachable"))?;
        let owned = flow
            .linked_route
            .as_ref()
            .ok_or_else(|| error("stationUnreachable"))?;
        if current.station_peer_id != owned.station_peer_id
            || current.route_id != owned.route_id
            || current.route_revision != owned.route_revision
        {
            return Err(error("sessionScopeChanged"));
        }
        let candidates = if flow.route_candidates.is_empty() {
            flow.offer()?.statement.connections.clone()
        } else {
            flow.route_candidates
                .iter()
                .map(|bytes| core::<DeviceLinkConnectionCandidate>(canonical(bytes)))
                .collect::<MobileResult<Vec<_>>>()?
        };
        flow.route_transition_candidates = candidates.iter().map(Message::encode_to_vec).collect();
        self.save(storage, flow, epoch)?;
        let route = station_route::device_link_reconnect(
            storage,
            &candidates,
            &flow.station_peer_id,
            &flow.station_root,
        )?;
        flow.canonical_origin = route.endpoint_origin.clone();
        flow.linked_route = Some(route);
        flow.route_source_ref =
            station_route::device_link_route(&flow.station_peer_id, &flow.station_root)?.source_ref;
        self.save(storage, flow, epoch)
    }

    fn restore_route(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        epoch: u64,
    ) -> MobileResult<()> {
        let previous = flow
            .linked_route
            .as_ref()
            .ok_or_else(|| error("stationUnreachable"))?;
        let restored = station_route::device_link_restore(
            storage,
            previous,
            &flow.route_source_ref,
            &flow.station_root,
        );
        flow.linked_route = Some(match restored {
            Ok(route) => route,
            Err(error) if !flow.route_transition_candidates.is_empty() => {
                // Only an intent persisted before the transition permits
                // re-admitting a different route, and never another Station.
                if let Some(active) = station_route::station_route_snapshot()? {
                    if active.station_peer_id != flow.station_peer_id {
                        return Err(error);
                    }
                    station_route::device_link_route(&flow.station_peer_id, &flow.station_root)?;
                }
                let candidates = flow
                    .route_transition_candidates
                    .iter()
                    .map(|bytes| core::<DeviceLinkConnectionCandidate>(canonical(bytes)))
                    .collect::<MobileResult<Vec<_>>>()?;
                let route = station_route::device_link_reconnect(
                    storage,
                    &candidates,
                    &flow.station_peer_id,
                    &flow.station_root,
                )?;
                flow.route_source_ref =
                    station_route::device_link_route(&flow.station_peer_id, &flow.station_root)?
                        .source_ref;
                flow.canonical_origin = route.endpoint_origin.clone();
                route
            }
            Err(error) => return Err(error),
        });
        self.save(storage, flow, epoch)
    }

    fn expired_without_delivery(flow: &Flow) -> MobileResult<bool> {
        let signed: SignedDeviceLinkOffer = core(canonical(&flow.offer_bytes))?;
        let statement: DeviceLinkOfferStatement = core(canonical(&signed.statement_bytes))?;
        Ok(
            statement.expires_at_unix_ms <= device_link_core::bootstrap::unix_ms()
                && flow.delivery_id.is_empty(),
        )
    }

    fn finish_expired(&self, storage: &SecureStorage, flow: &Flow) -> MobileResult<Projection> {
        link_session::discard(storage)?;
        if let Some(owned) = flow.linked_route.as_ref() {
            station_route::device_link_release(flow.previous_route.as_ref(), owned)?;
        }
        storage.remove(RECORD)?;
        Ok(Projection::idle())
    }

    fn update(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        status: DeviceLinkStatus,
        epoch: u64,
    ) -> MobileResult<()> {
        if status.offer_id != flow.offer_id
            || status.revision == 0
            || status.claims.iter().any(|c| c.claim_id != flow.claim_id)
        {
            return Err(error("statusScopeMismatch"));
        }
        if status.state == DeviceLinkState::ClaimsPending as i32 {
            let claim = status.claims.first().ok_or_else(|| error("invalidClaim"))?;
            let previous: DeviceLinkClaim = core(canonical(&flow.claim_bytes))?;
            if claim.statement_bytes != previous.statement_bytes
                || claim.mobile_device_signature != previous.mobile_device_signature
                || claim.access_attempt_id != previous.access_attempt_id
                || claim.profile_revision < previous.profile_revision
            {
                return Err(error("claimMismatch"));
            }
            core(transcript::verify_claim(claim, &flow.offer()?))?;
            flow.comparison_transcript = core(transcript::approval(
                &flow.offer()?,
                claim,
                status
                    .revision
                    .checked_add(1)
                    .ok_or_else(|| error("invalidRevision"))?,
            ))?
            .encode_to_vec();
            flow.claim_bytes = claim.encode_to_vec();
        }
        flow.status_bytes = status.encode_to_vec();
        self.fence(storage, flow, epoch)?;
        self.save(storage, flow, epoch)
    }

    fn poll_inner(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        epoch: u64,
    ) -> MobileResult<Projection> {
        let status = protocol::status(flow)?;
        self.update(storage, flow, status, epoch)?;
        let state: DeviceLinkStatus = core(canonical(&flow.status_bytes))?;
        if state.state >= DeviceLinkState::Denied as i32 {
            let projection = projection::project(flow)?;
            link_session::discard(storage)?;
            if let Some(owned) = flow.linked_route.as_ref() {
                station_route::device_link_release(flow.previous_route.as_ref(), owned)?;
            }
            storage.remove(RECORD)?;
            return Ok(projection);
        }
        if state.state == DeviceLinkState::Committed as i32 {
            self.commit(storage, flow, epoch)?;
            return projection::project(flow);
        }
        if state.reason == DeviceLinkErrorCode::ProfileStale as i32
            && !flow.identity_seed.is_empty()
        {
            self.prove(
                storage,
                flow,
                &flow.offer()?,
                state.current_profile_revision,
                state.revision,
                epoch,
            )?;
            return projection::project(flow);
        }
        if state.state >= DeviceLinkState::IdentityDelivery as i32 {
            self.receive_material(storage, flow, epoch)?;
        }
        projection::project(flow)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Store(Mutex<HashMap<String, String>>);
    impl SecretStore for Store {
        fn set_secret(&self, key: &str, value: &str) -> MobileResult<()> {
            self.0.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }
        fn get_secret(&self, key: &str) -> MobileResult<Option<String>> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }
        fn remove_secret(&self, key: &str) -> MobileResult<()> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    #[test]
    fn logout_cleanup_can_persist_recovered_claim_without_rebinding_auth_generation() {
        let storage = Store::default();
        let runtime = MobileDeviceLinkRuntime::default();
        let identity = oauth::load_or_create_identity(&storage).unwrap();
        let mut flow = Flow::default();
        flow.device_id = identity.device_id.clone();
        flow.auth_generation = identity.generation;
        flow.claim_request = b"original immutable request".to_vec();
        runtime.save(&storage, &flow, 0).unwrap();
        // The accepted Claim response was lost. Logout advances the canonical
        // auth generation while the same cancellation intent remains owned.
        let advanced = identity.generation + 1;
        storage.set_secret("oauth.auth.generation", &advanced.to_string()).unwrap();
        flow.cancel_requested = true;
        runtime.cleanup_fence(&storage, &flow, 0).unwrap();
        assert!(runtime.fence(&storage, &flow, 0).is_err());
        flow.claim_id = "recovered-original-claim".into();
        flow.claim_capability = vec![7; 32];
        runtime.save(&storage, &flow, 0).unwrap();
        let restored = MobileDeviceLinkRuntime::load(&storage).unwrap().unwrap();
        assert_eq!(restored.claim_id, flow.claim_id);
        assert_eq!(restored.auth_generation, identity.generation);
        assert_eq!(restored.claim_request, b"original immutable request");
        assert!(runtime.fence(&storage, &restored, 0).is_err());
    }

    #[test]
    fn cleanup_requires_cancel_intent_same_installation_and_current_epoch() {
        let storage = Store::default();
        let runtime = MobileDeviceLinkRuntime::default();
        let identity = oauth::load_or_create_identity(&storage).unwrap();
        let mut flow = Flow::default();
        flow.device_id = identity.device_id;
        flow.auth_generation = identity.generation;
        assert!(runtime.cleanup_fence(&storage, &flow, 0).is_err());
        flow.cancel_requested = true;
        runtime.cleanup_fence(&storage, &flow, 0).unwrap();
        flow.committed = true;
        assert!(runtime.cleanup_fence(&storage, &flow, 0).is_err());
        flow.committed = false;
        flow.device_id = "another-installation".into();
        assert!(runtime.cleanup_fence(&storage, &flow, 0).is_err());
        runtime.invalidate();
        assert!(runtime.cleanup_fence(&storage, &flow, 0).is_err());
        assert!(runtime.save(&storage, &flow, 0).is_err());
    }
}
