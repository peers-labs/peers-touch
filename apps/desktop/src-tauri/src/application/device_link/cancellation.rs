//! Remote cancellation keeps its original allocation until terminal read-back.
use super::{post, post_native, sign, station_error_code, Flow};
use device_link_core::{canonical, proto::*};
use prost::Message;

pub(super) fn cancel_flow(flow: &mut Flow) -> Result<(), String> {
    // Local preparation time cannot bound a later Station allocation. Ambiguous
    // Create keeps its exact request/key until recovery or terminal read-back.
    let Some(offer_id) = recover_offer_id(flow)? else {
        return Ok(());
    };
    if flow
        .status
        .as_ref()
        .is_some_and(|status| status.state >= DeviceLinkState::Committed as i32)
    {
        return Ok(());
    }
    let terminal = cancel_until_terminal(
        &offer_id,
        || read_status(flow, &offer_id),
        |revision| {
            let mut request = CancelDeviceLinkRequest {
                offer_id: offer_id.clone(),
                observed_revision: revision,
                ..Default::default()
            };
            request.desktop_device_signature =
                sign(&flow.signing, "cancel", &request.encode_to_vec());
            let response: CancelDeviceLinkResponse = post(flow, "cancel", &request)?;
            response
                .status
                .ok_or_else(|| "deviceLink.invalidStatus".into())
        },
    )?;
    flow.status = Some(terminal);
    Ok(())
}

fn recover_offer_id(flow: &mut Flow) -> Result<Option<String>, String> {
    if let Some(offer) = &flow.offer {
        return Ok(Some(offer.statement.offer_id.clone()));
    }
    if let Some(offer_id) = &flow.cancellation_offer_id {
        return Ok(Some(offer_id.clone()));
    }
    let Some(request) = &flow.create_request else {
        return Ok(None);
    };
    let response: CreateDeviceLinkResponse = match post_native(flow, "create", request) {
        Ok(response) => response,
        Err(error) => {
            if station_error_code(&error).as_deref() == Some("DEVICE_LINK_ERROR_CODE_PROFILE_STALE")
            {
                // Exact request lookup precedes this rejection on Station:
                // no allocation exists, so there is nothing to cancel.
                flow.create_request = None;
                return Ok(None);
            }
            if let Some(body) = error
                .details
                .as_ref()
                .and_then(|details| details.get("body"))
                .and_then(serde_json::Value::as_str)
                .filter(|body| body.len() <= 8192)
            {
                if let Some(status) = terminal_create_replay(body)? {
                    let id = status.offer_id.clone();
                    flow.cancellation_offer_id = Some(id.clone());
                    flow.status = Some(status);
                    return Ok(Some(id));
                }
            }
            return Err("deviceLink.cancellationPending".into());
        }
    };
    let id = cancellation_offer_id(
        &response,
        request,
        &flow.station_peer_id,
        &flow.station_root,
    )?;
    flow.cancellation_offer_id = Some(id.clone());
    Ok(Some(id))
}

fn terminal_create_replay(body: &str) -> Result<Option<DeviceLinkStatus>, String> {
    let body: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "deviceLink.cancellationPending")?;
    if body["code"] != "DEVICE_LINK_ERROR_CODE_OFFER_CANCELLED" {
        return Ok(None);
    }
    let status = &body["status"];
    let id = status["offer_id"]
        .as_str()
        .ok_or("deviceLink.cancellationPending")?;
    if id.is_empty() || id.len() > 128 {
        return Err("deviceLink.invalidStatus".into());
    }
    let state = match status["state"].as_str() {
        Some("DEVICE_LINK_STATE_COMMITTED") => DeviceLinkState::Committed,
        Some("DEVICE_LINK_STATE_DENIED") => DeviceLinkState::Denied,
        Some("DEVICE_LINK_STATE_CANCELLED") => DeviceLinkState::Cancelled,
        Some("DEVICE_LINK_STATE_EXPIRED") => DeviceLinkState::Expired,
        Some("DEVICE_LINK_STATE_REVOKED") => DeviceLinkState::Revoked,
        _ => return Err("deviceLink.cancellationPending".into()),
    };
    let revision = status["revision"]
        .as_u64()
        .or_else(|| status["revision"].as_str()?.parse().ok())
        .filter(|revision| *revision > 0)
        .ok_or("deviceLink.invalidStatus")?;
    Ok(Some(DeviceLinkStatus {
        offer_id: id.into(),
        state: state as i32,
        revision,
        ..Default::default()
    }))
}

/// Read an opaque lookup ID from the authenticated original-Station Create
/// response. Expired offers must remain cancellable. This does not construct a
/// VerifiedOffer, QR, approval authority, connection grant or credential.
/// Status and signed Cancel still revalidate ownership through Station.
fn cancellation_offer_id(
    response: &CreateDeviceLinkResponse,
    request: &CreateDeviceLinkRequest,
    station: &str,
    root: &[u8],
) -> Result<String, String> {
    let signed = response.offer.as_ref().ok_or("deviceLink.invalidOffer")?;
    let statement: DeviceLinkOfferStatement =
        canonical(&signed.statement_bytes).map_err(|_| "deviceLink.invalidOffer")?;
    let device = request
        .desktop_certificate
        .as_ref()
        .and_then(|certificate| certificate.device.as_ref())
        .ok_or("deviceLink.invalidOffer")?;
    if statement.protocol_version != device_link_core::PROTOCOL_VERSION
        || statement.station_peer_id != station
        || statement.station_root_public_key != root
        || statement.actor.as_ref() != device.actor.as_ref()
        || device
            .actor
            .as_ref()
            .is_none_or(|actor| actor.ptid.is_empty())
        || statement.desktop_device_id != device.device_id
        || device.device_id.is_empty()
        || statement.desktop_hpke_public_key != request.desktop_hpke_public_key
        || request.desktop_hpke_public_key.len() != 32
        || statement.offer_id.is_empty()
        || statement.offer_id.len() > 128
    {
        return Err("deviceLink.invalidOffer".into());
    }
    Ok(statement.offer_id.clone())
}

fn read_status(flow: &Flow, offer_id: &str) -> Result<DeviceLinkStatus, String> {
    let response: Result<GetDeviceLinkStatusResponse, _> = post_native(
        flow,
        "status",
        &GetDeviceLinkStatusRequest {
            offer_id: offer_id.into(),
            ..Default::default()
        },
    );
    match response {
        Ok(response) => response
            .status
            .ok_or_else(|| "deviceLink.invalidStatus".into()),
        Err(error) => {
            let body = error
                .details
                .as_ref()
                .and_then(|d| d.get("body"))
                .and_then(serde_json::Value::as_str)
                .filter(|s| s.len() <= 8192)
                .ok_or("deviceLink.cancellationPending")?;
            let body: serde_json::Value =
                serde_json::from_str(body).map_err(|_| "deviceLink.cancellationPending")?;
            if body["code"] != "DEVICE_LINK_ERROR_CODE_PROFILE_STALE"
                || body["status"]["offer_id"].as_str() != Some(offer_id)
            {
                return Err("deviceLink.cancellationPending".into());
            }
            let revision = body["status"]["revision"]
                .as_u64()
                .or_else(|| body["status"]["revision"].as_str()?.parse().ok())
                .ok_or("deviceLink.invalidStatus")?;
            Ok(DeviceLinkStatus {
                offer_id: offer_id.into(),
                revision,
                state: DeviceLinkState::AccessPending as i32,
                ..Default::default()
            })
        }
    }
}

fn cancel_until_terminal(
    offer_id: &str,
    mut read: impl FnMut() -> Result<DeviceLinkStatus, String>,
    mut submit: impl FnMut(u64) -> Result<DeviceLinkStatus, String>,
) -> Result<DeviceLinkStatus, String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    for _ in 0..3 {
        if std::time::Instant::now() >= deadline {
            break;
        }
        let status = read()?;
        if status.offer_id != offer_id {
            return Err("deviceLink.invalidStatus".into());
        }
        if status.state >= DeviceLinkState::Committed as i32 {
            return Ok(status);
        }
        if let Ok(status) = submit(status.revision) {
            if status.offer_id != offer_id {
                return Err("deviceLink.invalidStatus".into());
            }
            if status.state >= DeviceLinkState::Committed as i32 {
                return Ok(status);
            }
        }
        // Lost responses and CAS conflicts require authoritative read-back.
    }
    Err("deviceLink.cancellationPending".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use device_link_core::actor::{ActorDeviceCertificate, ActorDeviceRef, ActorRef};
    use std::cell::Cell;

    fn status(state: DeviceLinkState, revision: u64) -> DeviceLinkStatus {
        DeviceLinkStatus {
            offer_id: "offer".into(),
            state: state as i32,
            revision,
            // A live Station offer remains live regardless of local preparation.
            expires_at_unix_ms: i64::MAX,
            ..Default::default()
        }
    }

    #[test]
    fn live_offer_requires_cancellation_and_terminal_readback() {
        let submissions = Cell::new(0);
        let terminal = cancel_until_terminal(
            "offer",
            || Ok(status(DeviceLinkState::Open, 7)),
            |revision| {
                assert_eq!(revision, 7);
                submissions.set(submissions.get() + 1);
                Ok(status(DeviceLinkState::Cancelled, 8))
            },
        )
        .unwrap();
        assert_eq!(submissions.get(), 1);
        assert_eq!(terminal.state, DeviceLinkState::Cancelled as i32);
    }

    #[test]
    fn unresolved_remote_cancellation_does_not_release_ownership() {
        let submissions = Cell::new(0);
        let result = cancel_until_terminal(
            "offer",
            || Ok(status(DeviceLinkState::Open, 7)),
            |_| {
                submissions.set(submissions.get() + 1);
                Err("lost cancellation response".into())
            },
        );
        assert_eq!(submissions.get(), 3);
        assert_eq!(result.unwrap_err(), "deviceLink.cancellationPending");
    }

    #[test]
    fn lost_cancel_response_is_resolved_without_duplicate_mutation() {
        let reads = Cell::new(0);
        let submissions = Cell::new(0);
        let result = cancel_until_terminal(
            "offer",
            || {
                reads.set(reads.get() + 1);
                Ok(status(
                    if reads.get() == 1 {
                        DeviceLinkState::Open
                    } else {
                        DeviceLinkState::Cancelled
                    },
                    reads.get(),
                ))
            },
            |_| {
                submissions.set(submissions.get() + 1);
                Err("lost cancellation response".into())
            },
        )
        .unwrap();
        assert_eq!(result.state, DeviceLinkState::Cancelled as i32);
        assert_eq!(reads.get(), 2);
        assert_eq!(submissions.get(), 1);
    }

    #[test]
    fn another_offer_cannot_supply_terminal_proof() {
        let result = cancel_until_terminal(
            "original",
            || Ok(status(DeviceLinkState::Cancelled, 8)),
            |_| panic!("unexpected mutation"),
        );
        assert_eq!(result.unwrap_err(), "deviceLink.invalidStatus");
    }

    fn expired_response() -> (CreateDeviceLinkResponse, CreateDeviceLinkRequest) {
        let actor = ActorRef {
            ptid: "actor".into(),
            ..Default::default()
        };
        let request = CreateDeviceLinkRequest {
            desktop_hpke_public_key: vec![1; 32],
            desktop_certificate: Some(ActorDeviceCertificate {
                device: Some(ActorDeviceRef {
                    actor: Some(actor.clone()),
                    device_id: "device".into(),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let statement = DeviceLinkOfferStatement {
            protocol_version: 1,
            station_peer_id: "station".into(),
            station_root_public_key: vec![2; 32],
            actor: Some(actor),
            offer_id: "expired-offer".into(),
            desktop_device_id: "device".into(),
            desktop_hpke_public_key: request.desktop_hpke_public_key.clone(),
            issued_at_unix_ms: 1,
            expires_at_unix_ms: 2,
            ..Default::default()
        };
        (
            CreateDeviceLinkResponse {
                offer: Some(SignedDeviceLinkOffer {
                    statement_bytes: statement.encode_to_vec(),
                    ..Default::default()
                }),
                ..Default::default()
            },
            request,
        )
    }

    #[test]
    fn expired_ambiguous_create_can_recover_only_its_cancellation_lookup() {
        let (response, request) = expired_response();
        assert_eq!(
            cancellation_offer_id(&response, &request, "station", &[2; 32]).unwrap(),
            "expired-offer",
        );
        assert!(device_link_core::offer::verify(
            response.offer.as_ref().unwrap(),
            "station",
            &[2; 32],
            300_000,
        )
        .is_err());
    }

    #[test]
    fn cancellation_lookup_rejects_another_original_request_or_station() {
        let (response, mut request) = expired_response();
        assert!(cancellation_offer_id(&response, &request, "other", &[2; 32]).is_err());
        request.desktop_hpke_public_key = vec![3; 32];
        assert!(cancellation_offer_id(&response, &request, "station", &[2; 32]).is_err());
    }

    #[test]
    fn exact_terminal_replay_has_explicit_metadata_but_digest_conflict_does_not() {
        let terminal = terminal_create_replay(
            r#"{"code":"DEVICE_LINK_ERROR_CODE_OFFER_CANCELLED","status":{"offer_id":"expired","state":"DEVICE_LINK_STATE_EXPIRED","revision":"2"}}"#
        ).unwrap().unwrap();
        assert_eq!(terminal.offer_id, "expired");
        assert_eq!(terminal.state, DeviceLinkState::Expired as i32);
        assert!(
            terminal_create_replay(r#"{"code":"DEVICE_LINK_ERROR_CODE_OFFER_CANCELLED"}"#).is_err()
        );
        assert!(terminal_create_replay(
            r#"{"code":"DEVICE_LINK_ERROR_CODE_OFFER_CANCELLED","status":{"offer_id":"live","state":"DEVICE_LINK_STATE_OPEN","revision":"1"}}"#
        ).is_err());
    }
}
