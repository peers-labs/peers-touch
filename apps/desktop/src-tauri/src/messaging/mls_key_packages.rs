use crate::infrastructure::station_client;
use crate::infrastructure::station_client::{StationClientError, StationClientErrorKind};
use crate::model::error::ErrorCode as CanonicalErrorCode;
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

fn complete_mls_key_package_upload(
    result: Result<UploadMlsKeyPackageResponse, StationClientError>,
) -> Result<(), String> {
    match result {
        Ok(_) => Ok(()),
        Err(error)
            if matches!(error.kind, StationClientErrorKind::HttpStatus(409))
                && error
                    .details
                    .as_ref()
                    .and_then(|details| details.get("error_code"))
                    .and_then(serde_json::Value::as_str)
                    == Some(CanonicalErrorCode::ContentPrekeyStaleEpoch.as_str_name()) =>
        {
            Ok(())
        }
        Err(error) => Err(error.to_string()),
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
        complete_mls_key_package_upload(station_client::request_proto_for_device::<
            UploadMlsKeyPackageRequest,
            UploadMlsKeyPackageResponse,
        >(
            Method::POST,
            "/key-exchange/mls/key-package/upload",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        ))
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn station_conflict(code: &str) -> StationClientError {
        StationClientError::new(
            StationClientErrorKind::HttpStatus(409),
            "station returned 409",
            Some(json!({
                "status": 409,
                "error_code": code,
            })),
        )
    }

    #[test]
    fn consumed_key_package_replay_completes_local_publication() {
        let stale = station_conflict(CanonicalErrorCode::ContentPrekeyStaleEpoch.as_str_name());
        assert_eq!(complete_mls_key_package_upload(Err(stale)), Ok(()));
    }

    #[test]
    fn genuine_key_package_conflict_remains_failed() {
        let conflict =
            station_conflict(CanonicalErrorCode::ContentPrekeyReplayConflict.as_str_name());
        assert!(complete_mls_key_package_upload(Err(conflict))
            .unwrap_err()
            .contains(CanonicalErrorCode::ContentPrekeyReplayConflict.as_str_name()));
    }
}
