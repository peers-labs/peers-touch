//! Access actions and cancellation preserve the original native transaction.
use super::{core, error, projection, protocol, Flow, MobileDeviceLinkRuntime, Projection, RECORD};
use crate::{
    error::MobileResult,
    platform::secure_storage::SecureStorage,
    runtime::{
        oauth::{link_session, NativeAccessSubmitInput, OAuthCoordinator},
        station_route,
    },
};
use device_link_core::{canonical, proto::*};
use prost::Message;
use std::sync::atomic::Ordering;

impl MobileDeviceLinkRuntime {
    pub fn submit(
        &self,
        storage: &SecureStorage,
        oauth: &OAuthCoordinator,
        mut input: NativeAccessSubmitInput,
    ) -> MobileResult<Projection> {
        let _single = self.operation.try_lock().map_err(|_| error("busy"))?;
        let _auth = oauth.begin_operation()?;
        let epoch = self.epoch.load(Ordering::Acquire);
        let mut flow = Self::load(storage)?.ok_or_else(|| error("notReady"))?;
        self.fence(storage, &flow, epoch)?;
        self.restore_route(storage, &mut flow, epoch)?;
        let status: DeviceLinkStatus = core(canonical(&flow.status_bytes))?;
        input.station_origin = flow.canonical_origin.clone();
        input.station_peer_id = flow.station_peer_id.clone();
        if input.attempt_id
            != core::<DeviceLinkClaim>(canonical(&flow.claim_bytes))?.access_attempt_id
        {
            return Err(error("accessScopeMismatch"));
        }
        let submission = link_session::submission(storage, input)?;
        let submission = schema_core::proto::peers_touch::model::access_gate::v1::SubmitAccessGateRequest::decode(
            submission.encode_to_vec().as_slice(),
        ).map_err(|_| error("accessScopeMismatch"))?;
        let mut request = SubmitDeviceLinkAccessActionRequest {
            authorization: Some(protocol::authorization(&flow)),
            observed_revision: status.revision,
            submission: Some(submission),
        };
        let signature = protocol::sign(&flow, "access", &request.encode_to_vec());
        request.authorization.as_mut().unwrap().device_signature = signature;
        let response: SubmitDeviceLinkAccessActionResponse = protocol::post(
            &flow,
            "access",
            "SubmitDeviceLinkAccessActionResponse",
            &request,
        )?;
        self.update(
            storage,
            &mut flow,
            response.status.ok_or_else(|| error("invalidResponse"))?,
            epoch,
        )?;
        self.poll_inner(storage, &mut flow, epoch)
    }

    pub fn cancel(
        &self,
        storage: &SecureStorage,
        oauth: &OAuthCoordinator,
    ) -> MobileResult<Projection> {
        self.invalidate();
        let _single = self.operation.lock().map_err(|_| error("busy"))?;
        let _auth = oauth.begin_operation()?;
        let epoch = self.epoch.load(Ordering::Acquire);
        let Some(mut flow) = Self::load(storage)? else {
            return Ok(Projection::idle());
        };
        if flow.committed {
            storage.remove(RECORD)?;
            return Ok(Projection::idle());
        }
        flow.cancel_requested = true;
        self.save(storage, &flow, epoch)?;
        if Self::expired_without_delivery(&flow)? {
            return self.finish_expired(storage, &flow);
        }
        self.restore_route(storage, &mut flow, epoch)?;
        self.cancel_inner(storage, &mut flow, epoch)
    }

    pub(super) fn cancel_inner(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        epoch: u64,
    ) -> MobileResult<Projection> {
        if Self::expired_without_delivery(flow)? {
            return self.finish_expired(storage, flow);
        }
        // Resolve a claim whose response was lost before cancelling that same
        // immutable request. Never leave a hidden authorization attempt.
        self.recover_claim_for_cancel(storage, flow, epoch)?;
        let status = protocol::status(flow)?;
        if status.state == DeviceLinkState::Committed as i32 {
            if self.fence(storage, flow, epoch).is_err() {
                // Logout purged the staged Session. A new generation must never
                // reinstall its old credential, even after a lost ack response.
                link_session::discard(storage)?;
                storage.remove(RECORD)?;
                return Ok(Projection::idle());
            }
            self.update(storage, flow, status, epoch)?;
            self.commit(storage, flow, epoch)?;
            return projection::project(flow);
        }
        if status.state >= DeviceLinkState::Denied as i32 {
            link_session::discard(storage)?;
            if let Some(owned) = flow.linked_route.as_ref() {
                station_route::device_link_release(flow.previous_route.as_ref(), owned)?;
            }
            storage.remove(RECORD)?;
            return Ok(Projection::idle());
        }
        let mut request = CancelDeviceLinkRequest {
            offer_id: flow.offer_id.clone(),
            claim_authorization: Some(protocol::authorization(flow)),
            observed_revision: status.revision,
            desktop_device_signature: Vec::new(),
        };
        let signature = protocol::sign(flow, "cancel", &request.encode_to_vec());
        request
            .claim_authorization
            .as_mut()
            .unwrap()
            .device_signature = signature;
        let _: CancelDeviceLinkResponse =
            protocol::post(flow, "cancel", "CancelDeviceLinkResponse", &request)?;
        link_session::discard(storage)?;
        if let Some(owned) = flow.linked_route.as_ref() {
            station_route::device_link_release(flow.previous_route.as_ref(), owned)?;
        }
        storage.remove(RECORD)?;
        Ok(Projection::idle())
    }
}
