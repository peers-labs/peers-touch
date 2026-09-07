use super::{actor_device_parts, actor_ref};
use crate::infrastructure::station_client;
use crate::model::chat::CryptoEndpoint;
use crate::model::key_exchange::{
    DirectKeyBundle, FetchDirectKeyBundlesRequest, FetchDirectKeyBundlesResponse,
};
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
    fn fetch(&self, endpoint: &CryptoEndpoint) -> Result<DirectKeyBundle, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging key bundle endpoint is incomplete".to_string());
        }
        let response = station_client::request_proto_for_device::<
            FetchDirectKeyBundlesRequest,
            FetchDirectKeyBundlesResponse,
        >(
            Method::POST,
            "/key-exchange/keys/bundle/fetch",
            &self.token,
            None,
            Some(&FetchDirectKeyBundlesRequest {
                actor: Some(actor_ref(&endpoint.ptid)),
                target_device_id: endpoint.device_id.clone(),
                home_station_peer_id: String::new(),
            }),
            &self.device_id,
        )
        .map_err(|error| error.to_string())?;
        if response.bundles.len() != 1 {
            return Err("messaging endpoint key bundle is unavailable or ambiguous".to_string());
        }
        let bundle = response
            .bundles
            .into_iter()
            .next()
            .ok_or_else(|| "messaging endpoint key bundle is unavailable".to_string())?;
        let bundle_endpoint = bundle
            .device
            .as_ref()
            .and_then(actor_device_parts)
            .ok_or_else(|| "messaging endpoint key bundle has no device".to_string())?;
        if bundle_endpoint != (endpoint.ptid.as_str(), endpoint.device_id.as_str()) {
            return Err("messaging endpoint key bundle binding mismatch".to_string());
        }
        Ok(bundle)
    }
}
