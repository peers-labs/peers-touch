use std::io::Read;

use device_link_core::proto::*;
use ed25519_dalek::{Signer, SigningKey};
use prost::Message;
use zeroize::Zeroizing;

use super::{error, Flow};
use crate::error::MobileResult;

pub(super) fn sign(flow: &Flow, operation: &str, bytes: &[u8]) -> Vec<u8> {
    SigningKey::from_bytes(&flow.device_seed)
        .sign(
            &[
                format!("peers-touch/device-link/{operation}/v1\0").as_bytes(),
                bytes,
            ]
            .concat(),
        )
        .to_bytes()
        .to_vec()
}

pub(super) fn authorization(flow: &Flow) -> DeviceLinkClaimAuthorization {
    DeviceLinkClaimAuthorization {
        offer_id: flow.offer_id.clone(),
        claim_id: flow.claim_id.clone(),
        claim_capability: flow.claim_capability.clone(),
        device_signature: Vec::new(),
    }
}

pub(super) fn post<Req: Message, Resp: Message + Default>(
    flow: &Flow,
    operation: &str,
    _response_name: &str,
    request: &Req,
) -> MobileResult<Resp> {
    let binding = flow
        .linked_route
        .as_ref()
        .ok_or_else(|| error("stationUnreachable"))?;
    if binding.station_peer_id != flow.station_peer_id {
        return Err(error("stationRootMismatch"));
    }
    let request_bytes = Zeroizing::new(request.encode_to_vec());
    let response = crate::runtime::station_route::device_link_post(
        binding,
        &flow.station_root,
        operation,
        request_bytes.to_vec(),
    )
    .map_err(|failure| {
        error(if failure.message.ends_with(":standardRoundTrip") {
            "transportFailed"
        } else {
            "stationUnreachable"
        })
    })?;
    if !response.status.is_success() {
        if operation == "status" && response.status.as_u16() == 400 {
            let mut body = Zeroizing::new(Vec::new());
            response
                .body
                .take(8193)
                .read_to_end(&mut body)
                .map_err(|_| error("invalidResponse"))?;
            if body.len() > 8192 {
                return Err(error("invalidResponse"));
            }
            let value: serde_json::Value =
                serde_json::from_slice(&body).map_err(|_| error("stationRejected"))?;
            if value["code"] == "DEVICE_LINK_ERROR_CODE_PROFILE_STALE" {
                let detail = &value["status"];
                let integer = |name: &str| {
                    detail[name]
                        .as_u64()
                        .or_else(|| detail[name].as_str().and_then(|v| v.parse().ok()))
                };
                if detail["offer_id"].as_str() != Some(flow.offer_id.as_str()) {
                    return Err(error("statusScopeMismatch"));
                }
                let mut status = DeviceLinkStatus::decode(flow.status_bytes.as_slice())
                    .map_err(|_| error("invalidResponse"))?;
                status.current_profile_revision =
                    integer("current_profile_revision").ok_or_else(|| error("invalidResponse"))?;
                status.revision = integer("revision").ok_or_else(|| error("invalidResponse"))?;
                status.reason = DeviceLinkErrorCode::ProfileStale as i32;
                return Resp::decode(
                    GetDeviceLinkStatusResponse {
                        status: Some(status),
                    }
                    .encode_to_vec()
                    .as_slice(),
                )
                .map_err(|_| error("invalidResponse"));
            }
            return Err(error("stationRejected"));
        }
        // Never propagate the body, URL, capability or crypto material into UI
        // errors. The next status read reconciles ambiguous mutation outcomes.
        return Err(error(if response.status.as_u16() == 409 {
            "revisionConflict"
        } else {
            "stationRejected"
        }));
    }
    if response
        .headers
        .get("Content-Type")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.split(';').next())
        .map(str::trim)
        != Some("application/protobuf")
        || response
            .headers
            .get("Content-Length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .is_some_and(|n| n > 68 * 1024)
    {
        return Err(error("invalidResponse"));
    }
    let mut bytes = Zeroizing::new(Vec::new());
    response
        .body
        .take(68 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| error("stationUnreachable"))?;
    if bytes.len() > 68 * 1024 {
        return Err(error("invalidResponse"));
    }
    // Device Link's strict typed handlers emit their response message directly.
    Resp::decode(bytes.as_slice()).map_err(|_| error("invalidResponse"))
}

pub(super) fn status(flow: &Flow) -> MobileResult<DeviceLinkStatus> {
    let mut request = GetDeviceLinkStatusRequest {
        offer_id: flow.offer_id.clone(),
        claim_authorization: Some(authorization(flow)),
    };
    let signature = sign(flow, "status", &request.encode_to_vec());
    request
        .claim_authorization
        .as_mut()
        .unwrap()
        .device_signature = signature;
    let response: GetDeviceLinkStatusResponse =
        post(flow, "status", "GetDeviceLinkStatusResponse", &request)?;
    response.status.ok_or_else(|| error("invalidResponse"))
}

pub(super) fn material(flow: &Flow) -> MobileResult<GetDeviceLinkMaterialResponse> {
    let mut request = GetDeviceLinkMaterialRequest {
        authorization: Some(authorization(flow)),
    };
    let signature = sign(flow, "material", &request.encode_to_vec());
    request.authorization.as_mut().unwrap().device_signature = signature;
    post(flow, "material", "GetDeviceLinkMaterialResponse", &request)
}
