use super::actor_device_parts;
use crate::infrastructure::station_client;
use crate::model::key_exchange::{UploadMlsKeyPackageRequest, UploadMlsKeyPackageResponse};
use messaging_core::mls::key_packages::MlsKeyPackageTransport;
use reqwest::Method;

pub struct StationMlsKeyPackageTransport {
    token: String,
    device_id: String,
}

impl StationMlsKeyPackageTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() || device_id.trim().is_empty() {
            return Err(
                "messaging MLS KeyPackage transport requires token and device ID".to_string(),
            );
        }
        Ok(Self { token, device_id })
    }
}

impl MlsKeyPackageTransport for StationMlsKeyPackageTransport {
    fn upload(&self, request: &UploadMlsKeyPackageRequest) -> Result<(), String> {
        let (_, device_id) = request
            .device
            .as_ref()
            .and_then(actor_device_parts)
            .ok_or_else(|| "messaging MLS KeyPackage endpoint is incomplete".to_string())?;
        if device_id != self.device_id || request.key_package.is_empty() {
            return Err("messaging MLS KeyPackage endpoint binding mismatch".to_string());
        }
        station_client::request_proto_for_device::<
            UploadMlsKeyPackageRequest,
            UploadMlsKeyPackageResponse,
        >(
            Method::POST,
            "/key-exchange/mls/key-package/upload",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}
