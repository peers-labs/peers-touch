use crate::infrastructure::station_client;
use crate::model::chat::{UploadKeyPackageRequest, UploadKeyPackageResponse};
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
    fn upload(&self, request: &UploadKeyPackageRequest) -> Result<(), String> {
        if request.device_id != self.device_id || request.data.is_empty() {
            return Err("messaging MLS KeyPackage endpoint binding mismatch".to_string());
        }
        station_client::request_proto_for_device::<
            UploadKeyPackageRequest,
            UploadKeyPackageResponse,
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
