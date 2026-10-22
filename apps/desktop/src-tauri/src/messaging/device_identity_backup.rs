use super::{MessagingStore, StationDeviceTransport};
use crate::application::station_runtime::client::StationClient;
use crate::domain::crypto::{load_identity_key, store_identity_key, IdentityKeyPair};
use messaging_core::identity::enrollment::generate_device_identity_for_device_from_parts;
use messaging_core::identity::{validate_enrollment_response, FreshDeviceIdentityState};
use messaging_core::proto::actor::{
    ActorDevice, EnrollActorDeviceRequest, ListActorDevicesRequest, ListActorDevicesResponse,
};
use messaging_core::proto::actor_device_ptid;
use reqwest::Method;
use zeroize::Zeroizing;

fn key_ref(ptid: &str, device_id: &str) -> String {
    format!(
        "messaging-device-signing:{}:{ptid}:{}:{device_id}",
        ptid.len(),
        device_id.len()
    )
}

fn save_seed(ptid: &str, device_id: &str, seed: &[u8; 32]) -> Result<(), String> {
    let reference = key_ref(ptid, device_id);
    if let Some(previous) = load_identity_key(&reference).map_err(|error| error.to_string())? {
        if previous.seed_bytes() != *seed {
            return Err(
                "messaging device signing backup conflicts with local identity".to_string(),
            );
        }
        return Ok(());
    }
    store_identity_key(&reference, seed).map_err(|error| error.to_string())
}

pub(super) fn preserve_device_seed(store: &MessagingStore) -> Result<(), String> {
    let enrollment = store
        .device_enrollment()?
        .ok_or_else(|| "messaging device enrollment is unavailable".to_string())?;
    let device = enrollment
        .certificate
        .device
        .as_ref()
        .ok_or_else(|| "messaging device endpoint is unavailable".to_string())?;
    let (seed, signing_key_id) = store
        .device_signing_seed()?
        .ok_or_else(|| "messaging device signing key is unavailable".to_string())?;
    if signing_key_id != enrollment.certificate.signing_key_id {
        return Err("messaging device signing key identity is inconsistent".to_string());
    }
    save_seed(actor_device_ptid(device)?, &device.device_id, &seed)
}

pub(super) fn restore_backed_up_seed(
    store: &MessagingStore,
    ptid: &str,
    device_id: &str,
    actor_seed: &[u8; 32],
    profile_version: u64,
) -> Result<(), String> {
    if store.device_enrollment()?.is_some() {
        return Ok(());
    }
    if let Some(key) =
        load_identity_key(&key_ref(ptid, device_id)).map_err(|error| error.to_string())?
    {
        let seed = Zeroizing::new(key.seed_bytes());
        let identity = generate_device_identity_for_device_from_parts(
            ptid,
            device_id,
            actor_seed,
            profile_version,
            Some(&seed),
        )?;
        store.install_fresh_device_identity(&identity)?;
    }
    Ok(())
}

pub(super) fn prepare_recovery_identity(
    station: &StationClient,
    store: &MessagingStore,
    ptid: &str,
    device_id: &str,
    actor_seed: &[u8; 32],
    profile_version: u64,
    token: &str,
) -> Result<(FreshDeviceIdentityState, bool), String> {
    let response: ListActorDevicesResponse = station
        .request_proto_for_device(
            Method::GET,
            "/device/list",
            token,
            None,
            None::<&ListActorDevicesRequest>,
            device_id,
        )
        .map_err(|error| error.to_string())?;
    let remote = response.devices.iter().find(|device| {
        device
            .r#ref
            .as_ref()
            .is_some_and(|endpoint| endpoint.device_id == device_id)
    });
    let local = store.device_enrollment()?;
    let seed = if let Some(enrollment) = &local {
        let endpoint = enrollment
            .certificate
            .device
            .as_ref()
            .ok_or_else(|| "messaging recovery local endpoint is missing".to_string())?;
        if endpoint.device_id != device_id || actor_device_ptid(endpoint)? != ptid {
            return Err(
                "messaging recovery device does not match authenticated session".to_string(),
            );
        }
        let (seed, signing_key_id) = store
            .device_signing_seed()?
            .ok_or_else(|| "messaging recovery device signing key is unavailable".to_string())?;
        if signing_key_id != enrollment.certificate.signing_key_id {
            return Err("messaging recovery device signing identity is inconsistent".to_string());
        }
        Some(seed)
    } else {
        load_identity_key(&key_ref(ptid, device_id))
            .map_err(|error| error.to_string())?
            .map(|key| Zeroizing::new(key.seed_bytes()))
    };
    let version = profile_version
        .max(
            local
                .as_ref()
                .map_or(0, |value| value.certificate.observed_profile_version),
        )
        .max(
            response
                .devices
                .iter()
                .map(|value| value.profile_version)
                .max()
                .unwrap_or(0),
        );
    let seed = select_recovery_seed(seed, remote)?;
    let identity = generate_device_identity_for_device_from_parts(
        ptid,
        device_id,
        actor_seed,
        version,
        Some(&seed),
    )?;
    // Persist before enrollment: a lost response retries the same device key.
    save_seed(ptid, device_id, &seed)?;
    verify_recovery_enrollment(station, token, &identity)?;
    let preserve = local.as_ref().is_some_and(|enrollment| {
        enrollment.certificate.actor_identity_public_key
            == identity.enrollment.certificate.actor_identity_public_key
    });
    if preserve && local.as_ref() != Some(&identity.enrollment) {
        store.refresh_device_identity(&identity, true)?;
    }
    Ok((identity, preserve))
}

fn select_recovery_seed(
    seed: Option<Zeroizing<[u8; 32]>>,
    remote: Option<&ActorDevice>,
) -> Result<Zeroizing<[u8; 32]>, String> {
    if let Some(seed) = seed {
        return Ok(seed);
    }
    if remote.is_some_and(|device| {
        !device.signing_key_id.is_empty() || !device.device_signing_public_key.is_empty()
    }) {
        return Err("messaging recovery device signing key is unavailable; device authorization is required".to_string());
    }
    Ok(Zeroizing::new(IdentityKeyPair::generate().seed_bytes()))
}

pub(super) fn verify_recovery_enrollment(
    station: &StationClient,
    token: &str,
    identity: &FreshDeviceIdentityState,
) -> Result<(), String> {
    let endpoint = identity
        .enrollment
        .certificate
        .device
        .as_ref()
        .ok_or_else(|| "messaging recovery device endpoint is missing".to_string())?;
    let response = StationDeviceTransport::new(
        station.clone(),
        token.to_string(),
        endpoint.device_id.clone(),
    )?
    .enroll(&EnrollActorDeviceRequest {
        certificate: Some(identity.enrollment.certificate.clone()),
        actor_cross_signature: identity.enrollment.actor_cross_signature.to_vec(),
        label: "Desktop".to_string(),
    })?;
    validate_enrollment_response(
        &identity.enrollment,
        &response
            .device
            .ok_or_else(|| "messaging enrollment response has no device".to_string())?,
    )
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::application::station_runtime::client::{
        StationRequest, StationRequestBody, StationRequestExecutor, StationRequestScope,
        StationResponse, StationTransportError,
    };
    use messaging_core::proto::actor::{ActorDeviceStatus, EnrollActorDeviceResponse};
    use prost::Message;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    pub(crate) struct EnrollmentExecutor(Mutex<Option<ActorDevice>>);

    impl StationRequestExecutor for EnrollmentExecutor {
        fn execute(
            &self,
            request: StationRequest,
        ) -> Result<StationResponse, StationTransportError> {
            let bytes = match request.path_and_query.as_str() {
                "/device/list" => ListActorDevicesResponse {
                    devices: self.0.lock().unwrap().iter().cloned().collect(),
                }
                .encode_to_vec(),
                "/device/enroll" => {
                    let StationRequestBody::Bytes(body) = request.body else {
                        panic!("missing certificate")
                    };
                    let input = EnrollActorDeviceRequest::decode(body.as_slice()).unwrap();
                    let certificate = input.certificate.unwrap();
                    let mut device = self.0.lock().unwrap();
                    if let Some(previous) = device.as_ref() {
                        assert_eq!(previous.signing_key_id, certificate.signing_key_id);
                    }
                    *device = Some(ActorDevice {
                        r#ref: certificate.device,
                        signing_key_id: certificate.signing_key_id,
                        device_signing_public_key: certificate.device_signing_public_key,
                        actor_identity_key_fingerprint: certificate.actor_identity_key_fingerprint,
                        profile_version: certificate.observed_profile_version,
                        status: ActorDeviceStatus::Active as i32,
                        ..Default::default()
                    });
                    EnrollActorDeviceResponse {
                        device: device.clone(),
                    }
                    .encode_to_vec()
                }
                _ => Vec::new(),
            };
            Ok(StationResponse {
                status: 200,
                headers: Default::default(),
                body: Box::new(std::io::Cursor::new(bytes)),
            })
        }
        fn active_scope(&self) -> Option<StationRequestScope> {
            None
        }
        fn active_station_peer_id(&self) -> Option<String> {
            None
        }
        fn active_endpoint_origin(&self) -> Option<String> {
            None
        }
    }

    pub(crate) fn enrollment_station() -> StationClient {
        StationClient::new(Arc::new(EnrollmentExecutor::default()))
    }

    #[test]
    fn missing_seed_never_rotates_an_enrolled_installation() {
        let remote = ActorDevice {
            signing_key_id: "existing".to_string(),
            ..Default::default()
        };
        assert!(select_recovery_seed(None, Some(&remote)).is_err());
        assert!(select_recovery_seed(None, None).is_ok());
        let seed = Zeroizing::new([7; 32]);
        assert_eq!(
            *select_recovery_seed(Some(seed), Some(&remote)).unwrap(),
            [7; 32]
        );
    }

    #[test]
    fn recovery_after_database_loss_reuses_the_station_enrolled_signing_key() {
        let _guard = crate::infrastructure::storage::test_storage_env_lock();
        let device_id = format!("recovery-backup-{}", ulid::Ulid::new());
        let station = enrollment_station();
        let source = MessagingStore::in_memory().unwrap();
        let (identity, preserve) = prepare_recovery_identity(
            &station,
            &source,
            "ptid:alice",
            &device_id,
            &[17; 32],
            3,
            "token",
        )
        .unwrap();
        assert!(!preserve);
        let empty = MessagingStore::in_memory().unwrap();
        let (restored, preserve) = prepare_recovery_identity(
            &station,
            &empty,
            "ptid:alice",
            &device_id,
            &[17; 32],
            3,
            "token",
        )
        .unwrap();
        assert!(!preserve);
        assert_eq!(restored.enrollment, identity.enrollment);
        assert_eq!(
            restored.device_signing_seed.as_slice(),
            identity.device_signing_seed.as_slice()
        );
        crate::domain::crypto::identity::delete_identity_key(&key_ref("ptid:alice", &device_id))
            .unwrap();
    }
}
