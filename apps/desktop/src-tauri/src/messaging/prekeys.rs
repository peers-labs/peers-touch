use super::actor_device_parts;
use crate::infrastructure::station_client;
use crate::model::key_exchange::{UploadDirectKeyBundleRequest, UploadDirectKeyBundleResponse};
use reqwest::Method;

pub use messaging_core::crypto::prekeys::{PreKeyPublisher, PreKeyRepository, PreKeyTransport};

pub struct StationPreKeyTransport {
    token: String,
    device_id: String,
}

impl StationPreKeyTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() || device_id.trim().is_empty() {
            return Err("messaging prekey transport requires token and device ID".to_string());
        }
        Ok(Self { token, device_id })
    }
}

impl PreKeyTransport for StationPreKeyTransport {
    fn upload(&self, request: &UploadDirectKeyBundleRequest) -> Result<(), String> {
        let (_, device_id) = request
            .device
            .as_ref()
            .and_then(actor_device_parts)
            .ok_or_else(|| "messaging prekey upload endpoint is incomplete".to_string())?;
        if device_id != self.device_id {
            return Err("messaging prekey upload endpoint mismatch".to_string());
        }
        station_client::request_proto_for_device::<
            UploadDirectKeyBundleRequest,
            UploadDirectKeyBundleResponse,
        >(
            Method::POST,
            "/key-exchange/keys/bundle",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}
