use device_link_core::{canonical, proto::*, transcript};
use serde::Serialize;

use super::Flow;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimProjection {
    pub id: String,
    pub device_label: String,
    pub platform: String,
    pub comparison_code: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub offer_id: String,
    pub actor_ptid: String,
    pub station_name: String,
    pub qr_link: Option<String>,
    pub state: i32,
    pub revision: u64,
    pub expires_at_unix_ms: i64,
    pub claims: Vec<ClaimProjection>,
}

pub(super) fn project(flow: &Flow, status: &DeviceLinkStatus) -> Result<Projection, String> {
    let offer = flow.offer.as_ref().ok_or("deviceLink.notReady")?;
    let mut claims = Vec::new();
    for claim in &status.claims {
        if claim.state != DeviceLinkState::ClaimsPending as i32 {
            continue;
        }
        let mobile: DeviceLinkClaimStatement =
            canonical(&claim.statement_bytes).map_err(|e| e.to_string())?;
        let approval = transcript::approval(
            offer,
            claim,
            status
                .revision
                .checked_add(1)
                .ok_or("deviceLink.invalidRevision")?,
        )
        .map_err(|e| e.to_string())?;
        claims.push(ClaimProjection {
            id: claim.claim_id.clone(),
            device_label: mobile.device_label,
            platform: mobile.platform,
            comparison_code: transcript::comparison_code(&approval),
        });
    }
    Ok(Projection {
        offer_id: status.offer_id.clone(),
        actor_ptid: flow.session.actor.ptid.clone(),
        station_name: flow.station_name.clone(),
        qr_link: (status.state < DeviceLinkState::Approved as i32).then(|| flow.qr_link.clone()),
        state: status.state,
        revision: status.revision,
        expires_at_unix_ms: status.expires_at_unix_ms,
        claims,
    })
}
