use crate::infrastructure::station_client::{self, StationClientErrorKind};
use messaging_core::proto::actor::ActorDeviceRef;
use messaging_core::proto::actor_device_ptid;
use messaging_core::proto::key_exchange::{
    CountDirectOneTimePreKeysRequest, CountDirectOneTimePreKeysResponse,
    ReplenishDirectOneTimePreKeysRequest, ReplenishDirectOneTimePreKeysResponse,
    UploadDirectKeyBundleRequest, UploadDirectKeyBundleResponse,
};
use reqwest::Method;

pub use messaging_core::crypto::prekeys::{
    PreKeyInventoryTransport, PreKeyPublisher, PreKeyReplenishOutcome, PreKeyTransport,
    RemotePreKeyInventory,
};

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
        let device = request
            .device
            .as_ref()
            .ok_or_else(|| "messaging prekey upload device is missing".to_string())?;
        actor_device_ptid(device)?;
        if device.device_id != self.device_id {
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

impl PreKeyInventoryTransport for StationPreKeyTransport {
    fn inventory(
        &self,
        request: &CountDirectOneTimePreKeysRequest,
    ) -> Result<RemotePreKeyInventory, String> {
        validate_request_device(request.device.as_ref(), &self.device_id)?;
        match station_client::request_proto_for_device::<
            CountDirectOneTimePreKeysRequest,
            CountDirectOneTimePreKeysResponse,
        >(
            Method::GET,
            "/key-exchange/keys/count",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        ) {
            Ok(response) => Ok(RemotePreKeyInventory::Available(response.count)),
            Err(error) if matches!(error.kind, StationClientErrorKind::HttpStatus(404)) => {
                Ok(RemotePreKeyInventory::MissingBundle)
            }
            Err(error) => Err(error.to_string()),
        }
    }

    fn replenish(
        &self,
        request: &ReplenishDirectOneTimePreKeysRequest,
    ) -> Result<PreKeyReplenishOutcome, String> {
        validate_request_device(request.device.as_ref(), &self.device_id)?;
        match station_client::request_proto_for_device::<
            ReplenishDirectOneTimePreKeysRequest,
            ReplenishDirectOneTimePreKeysResponse,
        >(
            Method::POST,
            "/key-exchange/keys/replenish",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        ) {
            Ok(_) => Ok(PreKeyReplenishOutcome::Applied),
            Err(error) if matches!(error.kind, StationClientErrorKind::HttpStatus(404)) => {
                Ok(PreKeyReplenishOutcome::MissingBundle)
            }
            Err(error) => Err(error.to_string()),
        }
    }
}

fn validate_request_device(
    device: Option<&ActorDeviceRef>,
    expected_device_id: &str,
) -> Result<(), String> {
    let device =
        device.ok_or_else(|| "messaging prekey inventory device is missing".to_string())?;
    actor_device_ptid(device)?;
    if device.device_id != expected_device_id {
        return Err("messaging prekey inventory endpoint mismatch".to_string());
    }
    Ok(())
}
