//! Native scan admission and exact claim replay.
use super::{core, error, protocol, Flow, MobileDeviceLinkRuntime, Projection};
use crate::{
    error::MobileResult,
    messaging::lifecycle::linked_device_seed,
    platform::secure_storage::SecureStorage,
    runtime::{
        oauth::{self, OAuthCoordinator},
        station_route,
    },
};
use device_link_core::{canonical, crypto::ReceiverKey, offer, proto::*, transcript};
use ed25519_dalek::SigningKey;
use prost::Message;
use rand::RngCore;
use std::sync::atomic::Ordering;
use zeroize::{Zeroize, Zeroizing};

impl MobileDeviceLinkRuntime {
    pub fn receive(
        &self,
        storage: &SecureStorage,
        oauth: &OAuthCoordinator,
        payload: &str,
        platform: &str,
        expected_epoch: u64,
    ) -> MobileResult<Projection> {
        let _single = self.operation.try_lock().map_err(|_| error("busy"))?;
        let _auth = oauth.begin_operation()?;
        let epoch = self.epoch.load(Ordering::Acquire);
        if epoch != expected_epoch {
            return Err(error("cancelled"));
        }
        if Self::load(storage)?.is_some() {
            return Err(error("attemptExists"));
        }
        if oauth.projection(storage)?.session.is_some() {
            return Err(error("sessionScopeChanged"));
        }
        let action = match schema_core::parse(payload) {
            Ok(schema_core::Link::Action(a)) => a.action,
            _ => return Err(error("invalidQr")),
        };
        use schema_core::proto::schema_action::Action;
        let signed = match action {
            Some(Action::DeviceLinkOffer(signed)) => signed,
            Some(Action::DeviceLinkLocator(mut locator)) => {
                let result = core(device_link_core::bootstrap::retrieve(
                    &locator,
                    |scope, bytes| {
                        station_route::sign_bootstrap_source(scope, bytes)
                            .map_err(|_| device_link_core::Error("sourceProofUnavailable"))
                    },
                ));
                locator.unsealing_key.zeroize();
                result?.signed.clone()
            }
            _ => return Err(error("invalidQr")),
        };
        let statement: DeviceLinkOfferStatement = core(canonical(&signed.statement_bytes))?;
        let verified = core(offer::verify(
            &signed,
            &statement.station_peer_id,
            &statement.station_root_public_key,
            device_link_core::bootstrap::unix_ms(),
        ))?;
        if !matches!(platform, "android" | "ios") {
            return Err(error("nativeCameraRequired"));
        }
        let identity = oauth::load_or_create_identity(storage)?;
        let actor = verified
            .statement
            .actor
            .as_ref()
            .ok_or_else(|| error("invalidActor"))?;
        let device_seed = linked_device_seed(
            storage,
            &statement.station_peer_id,
            &actor.ptid,
            &identity.device_id,
        )?
        .unwrap_or_else(|| Zeroizing::new(SigningKey::generate(&mut rand::rngs::OsRng).to_bytes()));
        let receiver = ReceiverKey::generate();
        let mut flow = Flow {
            offer_bytes: signed.encode_to_vec(),
            offer_id: statement.offer_id.clone(),
            station_peer_id: statement.station_peer_id.clone(),
            station_root: statement.station_root_public_key.clone(),
            actor_ptid: actor.ptid.clone(),
            device_id: identity.device_id,
            auth_generation: identity.generation,
            receiver_seed: *receiver.private_for_secure_storage(),
            device_seed: *device_seed,
            claim_request: Vec::new(),
            claim_id: String::new(),
            claim_bytes: Vec::new(),
            claim_capability: Vec::new(),
            comparison_transcript: Vec::new(),
            identity_seed: Vec::new(),
            canonical_origin: String::new(),
            status_bytes: Vec::new(),
            delivery_id: String::new(),
            credential_digest: Vec::new(),
            session_id: String::new(),
            committed: false,
            cancel_requested: false,
            proved_profile: 0,
            session: None,
            previous_route: station_route::station_route_snapshot()?,
            linked_route: None,
            route_source_ref: String::new(),
            route_transition_candidates: Vec::new(),
            route_candidates: Vec::new(),
        };
        let route = match station_route::device_link_connect(
            storage,
            &verified.statement.connections,
            &flow.station_peer_id,
            &flow.station_root,
        ) {
            Ok(route) => route,
            Err(error) => {
                if let Some(owned) = station_route::station_route_snapshot()? {
                    if owned.station_peer_id == flow.station_peer_id {
                        station_route::device_link_release(flow.previous_route.as_ref(), &owned)?;
                    }
                }
                return Err(error);
            }
        };
        flow.canonical_origin = route.endpoint_origin.clone();
        flow.linked_route = Some(route);
        flow.route_source_ref =
            station_route::device_link_route(&flow.station_peer_id, &flow.station_root)?.source_ref;
        let (source, _) = station_route::device_link_source(b"")?;
        let mut nonce = vec![0; 32];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let claim = DeviceLinkClaimStatement {
            protocol_version: 1,
            offer_id: flow.offer_id.clone(),
            request_id: ulid::Ulid::new().to_string(),
            station_peer_id: flow.station_peer_id.clone(),
            mobile_device_id: flow.device_id.clone(),
            platform: platform.to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            device_label: if platform == "ios" {
                "iPhone"
            } else {
                "Android"
            }
            .to_string(),
            mobile_hpke_public_key: receiver.public().to_vec(),
            mobile_device_signing_public_key: SigningKey::from_bytes(&device_seed)
                .verifying_key()
                .to_bytes()
                .to_vec(),
            claim_nonce: nonce,
            lifecycle_generation: flow.auth_generation,
            transport_source_public_key: source,
        };
        let bytes = claim.encode_to_vec();
        flow.claim_request = ClaimDeviceLinkRequest {
            offer_id: flow.offer_id.clone(),
            scan_capability: verified.statement.scan_capability.clone(),
            device_signature: protocol::sign(&flow, "claim", &bytes),
            statement_bytes: bytes,
        }
        .encode_to_vec();
        if let Err(error) = self.save(storage, &flow, epoch) {
            if let Some(owned) = flow.linked_route.as_ref() {
                station_route::device_link_release(flow.previous_route.as_ref(), owned)?;
            }
            return Err(error);
        }
        self.claim(storage, &mut flow, epoch)?;
        self.poll_inner(storage, &mut flow, epoch)
    }

    pub(super) fn claim(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        epoch: u64,
    ) -> MobileResult<()> {
        self.fence(storage, flow, epoch)?;
        self.claim_inner(storage, flow, epoch, false)
    }

    pub(super) fn recover_claim_for_cancel(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        epoch: u64,
    ) -> MobileResult<()> {
        self.cleanup_fence(storage, flow, epoch)?;
        self.claim_inner(storage, flow, epoch, true)
    }

    fn claim_inner(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        epoch: u64,
        cleanup: bool,
    ) -> MobileResult<()> {
        if !flow.claim_id.is_empty() {
            return Ok(());
        }
        let request: ClaimDeviceLinkRequest = core(canonical(&flow.claim_request))?;
        let response: ClaimDeviceLinkResponse =
            protocol::post(flow, "claim", "ClaimDeviceLinkResponse", &request)?;
        let claim = response.claim.ok_or_else(|| error("invalidResponse"))?;
        if response.claim_capability.len() != 32
            || claim.statement_bytes != request.statement_bytes
            || claim.mobile_device_signature != request.device_signature
        {
            return Err(error("claimMismatch"));
        }
        core(transcript::verify_claim(&claim, &flow.offer()?))?;
        if cleanup {
            self.cleanup_fence(storage, flow, epoch)?;
        } else {
            self.fence(storage, flow, epoch)?;
        }
        flow.claim_id = claim.claim_id.clone();
        flow.claim_bytes = claim.encode_to_vec();
        flow.claim_capability = response.claim_capability;
        self.save(storage, flow, epoch)
    }
}
