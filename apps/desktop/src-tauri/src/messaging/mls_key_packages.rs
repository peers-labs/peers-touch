use crate::infrastructure::station_client;
use crate::model::key_exchange::{
    CountMlsKeyPackagesRequest, CountMlsKeyPackagesResponse, UploadMlsKeyPackageRequest,
    UploadMlsKeyPackageResponse,
};
use messaging_core::mls::key_packages::MlsKeyPackageTransport;
use messaging_core::proto::actor::ActorDeviceRef;
use messaging_core::proto::actor_device_ptid;
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
        let device = request
            .device
            .as_ref()
            .ok_or_else(|| "messaging MLS KeyPackage device is missing".to_string())?;
        actor_device_ptid(device)?;
        if device.device_id != self.device_id || request.key_package.is_empty() {
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

    fn available_count(&self, device: &ActorDeviceRef) -> Result<u64, String> {
        actor_device_ptid(device)?;
        if device.device_id != self.device_id {
            return Err("messaging MLS KeyPackage count endpoint binding mismatch".to_string());
        }
        let response = station_client::request_proto_for_device::<
            CountMlsKeyPackagesRequest,
            CountMlsKeyPackagesResponse,
        >(
            Method::GET,
            "/key-exchange/mls/key-package/count",
            &self.token,
            None,
            Some(&CountMlsKeyPackagesRequest {
                device: Some(device.clone()),
            }),
            &self.device_id,
        )
        .map_err(|error| error.to_string())?;
        u64::try_from(response.count)
            .map_err(|_| "messaging MLS KeyPackage count is negative".to_string())
    }
}
