use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::station_transport::{
    station_transport_execute, StationTransportExecuteInput, StationTransportResponse,
    StationTransportRuntime,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SocialAdapterExecuteInput {
    request_id: String,
    station_peer_id: String,
    actor_ptid: String,
    session_id: String,
    operation: Value,
}

/// Social-owned entry point over the shared authenticated Station transport.
///
/// The transport remains the single credential, origin-policy, cancellation,
/// and response-boundary owner. Web callers receive only the sanitized response
/// projection and cannot provide bearer material.
#[tauri::command]
pub async fn social_adapter_execute(
    runtime: State<'_, StationTransportRuntime>,
    storage: State<'_, SecureStorage>,
    input: SocialAdapterExecuteInput,
) -> MobileResult<StationTransportResponse> {
    require_social_operation(&input.operation)?;
    let station_input: StationTransportExecuteInput = serde_json::from_value(json!({
        "requestId": input.request_id,
        "stationPeerId": input.station_peer_id,
        "actorPtid": input.actor_ptid,
        "sessionId": input.session_id,
        "operation": input.operation,
    }))
    .map_err(|error| MobileError::social(format!("invalid Social adapter input: {error}")))?;
    station_transport_execute(runtime, storage, station_input).await
}

fn require_social_operation(operation: &Value) -> MobileResult<()> {
    let operation_id = operation
        .get("operationId")
        .and_then(Value::as_str)
        .ok_or_else(|| MobileError::social("Social adapter operationId is required"))?;
    if matches!(
        operation_id,
        "moments_timeline"
            | "moments_post_get"
            | "moments_react"
            | "moments_unreact"
            | "moments_comments_list"
            | "moments_comment_create"
            | "moments_comment_delete"
            | "moments_create"
    ) {
        return Ok(());
    }
    Err(MobileError::social(
        "Social adapter operation is outside the Social boundary",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn social_adapter_accepts_only_social_operations() {
        assert!(require_social_operation(&json!({
            "operationId": "moments_timeline"
        }))
        .is_ok());
        assert!(require_social_operation(&json!({
            "operationId": "actor_profile_get"
        }))
        .is_err());
    }
}
