use crate::infrastructure::station_client;
use crate::model::key_exchange::{
    DirectKeyBundle, FetchDirectKeyBundlesRequest, FetchDirectKeyBundlesResponse,
};
use messaging_core::proto::actor::ActorDeviceRef;
use messaging_core::proto::{actor_device_ptid, actor_ref};
use reqwest::Method;

pub use messaging_core::outbox::{DirectSessionBootstrapper, KeyBundleTransport};

pub struct StationKeyBundleTransport {
    token: String,
    device_id: String,
}

impl StationKeyBundleTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() || device_id.trim().is_empty() {
            return Err("messaging key bundle transport requires token and device ID".to_string());
        }
        Ok(Self { token, device_id })
    }
}

impl KeyBundleTransport for StationKeyBundleTransport {
    fn fetch(
        &self,
        request_id: &str,
        requester: &ActorDeviceRef,
        endpoint: &ActorDeviceRef,
    ) -> Result<DirectKeyBundle, String> {
        let endpoint_ptid = actor_device_ptid(endpoint)?;
        if endpoint.device_id.trim().is_empty()
            || request_id.trim().is_empty()
            || requester.device_id != self.device_id
            || actor_device_ptid(requester).is_err()
        {
            return Err("messaging key bundle endpoint is incomplete".to_string());
        }
        let fetch_request = FetchDirectKeyBundlesRequest {
            actor: Some(actor_ref(endpoint_ptid)),
            target_device_id: endpoint.device_id.clone(),
            home_station_peer_id: String::new(),
            request_id: request_id.to_string(),
            requester: Some(requester.clone()),
        };
        let result = station_client::request_proto_for_device::<
            FetchDirectKeyBundlesRequest,
            FetchDirectKeyBundlesResponse,
        >(
            Method::POST,
            "/key-exchange/keys/bundle/fetch",
            &self.token,
            None,
            Some(&fetch_request),
            &self.device_id,
        );
        // #region debug-point M-N-O:direct-key-bundle-fetch
        let _ = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_millis(500))
            .build()
            .and_then(|client| {
                client
                    .post("http://10.4.55.179:7779/event")
                    .json(&serde_json::json!({
                        "sessionId": "conversation-open-500",
                        "runId": "direct-bundle-fetch-pre-fix",
                        "hypothesisId": "M-N-O",
                        "location": "messaging/direct_session.rs:fetch",
                        "msg": "[DEBUG] Direct key bundle fetch",
                        "data": {
                            "requesterPtid": actor_device_ptid(requester).unwrap_or_default(),
                            "requesterDeviceId": requester.device_id,
                            "targetPtid": endpoint_ptid,
                            "targetDeviceId": endpoint.device_id,
                            "ok": result.is_ok(),
                            "error": result.as_ref().err().map(ToString::to_string),
                            "returnedEndpoints": result
                                .as_ref()
                                .ok()
                                .map(|response| response.bundles.iter().map(|bundle| {
                                    serde_json::json!({
                                        "ptid": bundle
                                            .device
                                            .as_ref()
                                            .and_then(|device| device.actor.as_ref())
                                            .map(|actor| actor.ptid.as_str())
                                            .unwrap_or_default(),
                                        "deviceId": bundle
                                            .device
                                            .as_ref()
                                            .map(|device| device.device_id.as_str())
                                            .unwrap_or_default(),
                                    })
                                }).collect::<Vec<_>>())
                                .unwrap_or_default(),
                        }
                    }))
                    .send()
            });
        // #endregion
        let response = result.map_err(|error| error.to_string())?;
        if response.bundles.len() != 1 {
            return Err("messaging endpoint key bundle is unavailable or ambiguous".to_string());
        }
        let bundle = response
            .bundles
            .into_iter()
            .next()
            .ok_or_else(|| "messaging endpoint key bundle is unavailable".to_string())?;
        let returned_endpoint = bundle
            .device
            .as_ref()
            .ok_or_else(|| "messaging endpoint key bundle has no device".to_string())?;
        if !same_actor_device_identity(endpoint, returned_endpoint)? {
            return Err("messaging endpoint key bundle binding mismatch".to_string());
        }
        Ok(bundle)
    }
}

fn same_actor_device_identity(
    expected: &ActorDeviceRef,
    actual: &ActorDeviceRef,
) -> Result<bool, String> {
    Ok(actor_device_ptid(expected)? == actor_device_ptid(actual)?
        && expected.device_id == actual.device_id)
}

#[cfg(test)]
mod tests {
    use super::same_actor_device_identity;
    use messaging_core::proto::actor_device_ref;

    #[test]
    fn endpoint_binding_ignores_non_identity_actor_metadata() {
        let expected = actor_device_ref("ptid:alice", "alice-device");
        let mut returned = expected.clone();
        returned.actor.as_mut().expect("actor").acct = "alice@example.test".to_string();

        assert_ne!(expected, returned);
        assert!(same_actor_device_identity(&expected, &returned).expect("identity"));
    }

    #[test]
    fn endpoint_binding_rejects_different_actor_or_device() {
        let expected = actor_device_ref("ptid:alice", "alice-device");
        let other_actor = actor_device_ref("ptid:bob", "alice-device");
        let other_device = actor_device_ref("ptid:alice", "other-device");

        assert!(!same_actor_device_identity(&expected, &other_actor).expect("actor"));
        assert!(!same_actor_device_identity(&expected, &other_device).expect("device"));
    }
}
