use super::{core, error, Flow};
use crate::{
    error::MobileResult,
    runtime::oauth::{self, NativeSessionProjection, OAuthAccessDecisionProjection},
};
use device_link_core::{canonical, proto::*, transcript};
use prost::Message;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub phase: String,
    pub state: i32,
    pub station_peer_id: String,
    pub station_origin: String,
    pub actor_ptid: String,
    pub actor_label: String,
    pub device_id: String,
    pub comparison_code: String,
    pub expires_at_unix_ms: i64,
    pub revision: u64,
    pub access_decision: Option<OAuthAccessDecisionProjection>,
    pub session: Option<NativeSessionProjection>,
    pub route: Option<crate::runtime::station_route::StationRouteCandidate>,
    pub route_revision: u64,
}
impl Projection {
    pub fn idle() -> Self {
        Self {
            phase: "idle".into(),
            state: 0,
            station_peer_id: String::new(),
            station_origin: String::new(),
            actor_ptid: String::new(),
            actor_label: String::new(),
            device_id: String::new(),
            comparison_code: String::new(),
            expires_at_unix_ms: 0,
            revision: 0,
            access_decision: None,
            session: None,
            route: None,
            route_revision: 0,
        }
    }
}
pub(super) fn project(flow: &Flow) -> MobileResult<Projection> {
    let status: DeviceLinkStatus = core(canonical(&flow.status_bytes))?;
    let offer: SignedDeviceLinkOffer = core(canonical(&flow.offer_bytes))?;
    let statement: DeviceLinkOfferStatement = core(canonical(&offer.statement_bytes))?;
    let code = if flow.comparison_transcript.is_empty() {
        String::new()
    } else {
        transcript::comparison_code(&core::<DeviceLinkApprovalTranscript>(canonical(
            &flow.comparison_transcript,
        ))?)
    };
    let decision = status
        .access_decision
        .as_ref()
        .map(|d| {
            let d =
                oauth::proto::access_gate::v1::AccessDecision::decode(d.encode_to_vec().as_slice())
                    .map_err(|_| error("invalidDecision"))?;
            oauth::access_decision_projection(&d)
        })
        .transpose()?;
    Ok(Projection {
        phase: if flow.committed {
            "committed"
        } else if flow.cancel_requested {
            "cancelling"
        } else {
            "linking"
        }
        .into(),
        state: status.state,
        station_peer_id: flow.station_peer_id.clone(),
        station_origin: flow.canonical_origin.clone(),
        actor_ptid: flow.actor_ptid.clone(),
        actor_label: statement
            .actor
            .map(|a| if a.acct.is_empty() { a.ptid } else { a.acct })
            .unwrap_or_default(),
        device_id: flow.device_id.clone(),
        comparison_code: code,
        expires_at_unix_ms: status.expires_at_unix_ms,
        revision: status.revision,
        access_decision: decision,
        session: flow.session.clone(),
        route: if status.state < DeviceLinkState::Denied as i32 {
            Some(crate::runtime::station_route::device_link_route(
                &flow.station_peer_id,
                &flow.station_root,
            )?)
        } else {
            None
        },
        route_revision: flow
            .linked_route
            .as_ref()
            .map(|route| route.route_revision)
            .unwrap_or_default(),
    })
}
