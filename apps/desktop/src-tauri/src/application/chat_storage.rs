//! Station presence helpers. Legacy group-chat HTTP clients were removed during
//! CCU-03 (Chat Client Unification); all group operations now go through the
//! unified conversation engine.

use crate::infrastructure::station_client;
use crate::model;
use reqwest::Method;
use serde_json::{json, Value};

type StationResult<T> = Result<T, station_client::StationClientError>;

fn ts_millis(ts: &Option<prost_types::Timestamp>) -> serde_json::Value {
    match ts {
        Some(t) => {
            serde_json::Value::Number((t.seconds * 1000 + (t.nanos as i64) / 1_000_000).into())
        }
        None => serde_json::Value::Null,
    }
}

fn presence_update_response_to_value(resp: &model::presence::PresenceUpdateResponse) -> Value {
    json!({
        "actorPtid": resp.actor_ptid,
        "sessionId": resp.session_id,
        "state": resp.state,
        "leaseExpiresAt": ts_millis(&resp.lease_expires_at),
    })
}

pub fn presence_heartbeat(token: &str, reason: &str) -> StationResult<Value> {
    let req = model::presence::PresenceHeartbeatRequest {
        reason: reason.to_string(),
    };
    let resp = station_client::request_proto::<
        model::presence::PresenceHeartbeatRequest,
        model::presence::PresenceUpdateResponse,
    >(Method::POST, "/presence/heartbeat", token, None, Some(&req))?;
    Ok(presence_update_response_to_value(&resp))
}

pub fn presence_offline(token: &str, reason: &str) -> StationResult<Value> {
    let req = model::presence::PresenceOfflineRequest {
        reason: reason.to_string(),
    };
    let resp = station_client::request_proto::<
        model::presence::PresenceOfflineRequest,
        model::presence::PresenceUpdateResponse,
    >(Method::POST, "/presence/offline", token, None, Some(&req))?;
    Ok(presence_update_response_to_value(&resp))
}
