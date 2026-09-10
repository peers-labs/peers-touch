use super::keys::{DeviceSigningKey, IdentityKeyPair};
use crate::proto::actor::{
    ActorDevice, ActorDeviceCertificate, ActorDeviceStatus, EnrollActorDeviceRequest,
    EnrollActorDeviceResponse,
};
use crate::proto::{actor_device_ptid, actor_device_ref};
use prost::Message;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use ulid::Ulid;

pub const MESSAGING_DEVICE_CERTIFICATE_FORMAT_VERSION: u32 = 1;
pub const INITIAL_ACTOR_IDENTITY_PROFILE_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq)]
pub struct FreshDeviceEnrollment {
    pub certificate: ActorDeviceCertificate,
    pub actor_cross_signature: [u8; 64],
}

pub struct FreshDeviceIdentityState {
    pub enrollment: FreshDeviceEnrollment,
    pub device_signing_seed: [u8; 32],
}

pub trait DeviceEnrollmentRepository: Send + Sync {
    fn device_enrollment(&self) -> Result<Option<FreshDeviceEnrollment>, String>;

    fn install_fresh_device_identity(&self, state: &FreshDeviceIdentityState)
        -> Result<(), String>;

    fn pending_device_enrollment(&self) -> Result<Option<FreshDeviceEnrollment>, String>;

    fn complete_device_enrollment(&self, device_id: &str) -> Result<(), String>;

    fn reset_device_enrollment(&self) -> Result<bool, String>;
}

pub trait DeviceEnrollmentTransport: Send + Sync {
    fn enroll(
        &self,
        request: &EnrollActorDeviceRequest,
    ) -> Result<EnrollActorDeviceResponse, String>;
}

pub fn load_or_create_device_identity<R: DeviceEnrollmentRepository>(
    repository: &R,
    ptid: &str,
    actor_identity_seed: [u8; 32],
    actor_profile_version: u64,
) -> Result<FreshDeviceEnrollment, String> {
    match repository.device_enrollment()? {
        Some(enrollment) => {
            validate_enrollment_actor(
                &enrollment,
                ptid,
                actor_identity_seed,
                actor_profile_version,
            )?;
            Ok(enrollment)
        }
        None => {
            let identity =
                generate_fresh_device_identity(ptid, actor_identity_seed, actor_profile_version)?;
            repository.install_fresh_device_identity(&identity)?;
            Ok(identity.enrollment)
        }
    }
}

pub struct DeviceEnrollmentManager<R> {
    repository: Arc<R>,
    ptid: String,
    device_id: String,
}

impl<R: DeviceEnrollmentRepository> DeviceEnrollmentManager<R> {
    pub fn new(repository: Arc<R>, ptid: String, device_id: String) -> Result<Self, String> {
        if ptid.trim().is_empty() || device_id.trim().is_empty() {
            return Err("messaging device enrollment manager requires endpoint".to_string());
        }
        Ok(Self {
            repository,
            ptid,
            device_id,
        })
    }

    pub fn enroll_pending<T: DeviceEnrollmentTransport>(
        &self,
        label: String,
        transport: &T,
    ) -> Result<Option<ActorDevice>, String> {
        let Some(enrollment) = self.repository.pending_device_enrollment()? else {
            return Ok(None);
        };
        let certificate = &enrollment.certificate;
        if actor_device_ptid(
            certificate
                .device
                .as_ref()
                .ok_or_else(|| "messaging pending enrollment has no endpoint".to_string())?,
        )? != self.ptid
            || certificate
                .device
                .as_ref()
                .map(|device| device.device_id.as_str())
                != Some(self.device_id.as_str())
        {
            return Err("messaging pending enrollment belongs to another endpoint".to_string());
        }
        let response = transport.enroll(&EnrollActorDeviceRequest {
            certificate: Some(certificate.clone()),
            label,
            actor_cross_signature: enrollment.actor_cross_signature.to_vec(),
        })?;
        let device = response
            .device
            .ok_or_else(|| "messaging enrollment response has no device".to_string())?;
        validate_enrollment_response(&enrollment, &device)?;
        self.repository
            .complete_device_enrollment(&self.device_id)?;
        Ok(Some(device))
    }

    pub fn recover_stale(&self, error: &str) -> Result<bool, String> {
        if !is_stale_endpoint_error(error) {
            return Ok(false);
        }
        self.repository.reset_device_enrollment()
    }
}

pub fn generate_fresh_device_identity(
    ptid: &str,
    actor_identity_seed: [u8; 32],
    actor_profile_version: u64,
) -> Result<FreshDeviceIdentityState, String> {
    if ptid.trim().is_empty() || actor_profile_version == 0 {
        return Err("fresh messaging identity requires PTID and profile version".to_string());
    }
    let actor_identity = IdentityKeyPair::from_seed(&actor_identity_seed);
    let device_id = Ulid::new().to_string();
    let device_signing_key =
        DeviceSigningKey::generate_cross_signed(&actor_identity, &device_id, |device_key| {
            build_device_certificate(
                ptid,
                &device_id,
                actor_profile_version,
                &actor_identity,
                device_key.as_bytes(),
            )
            .encode_to_vec()
        });
    let certificate = build_device_certificate(
        ptid,
        &device_id,
        actor_profile_version,
        &actor_identity,
        device_signing_key.verifying_key().as_bytes(),
    );
    Ok(FreshDeviceIdentityState {
        enrollment: FreshDeviceEnrollment {
            certificate,
            actor_cross_signature: device_signing_key.cross_signature().to_bytes(),
        },
        device_signing_seed: device_signing_key.seed_bytes(),
    })
}

pub fn validate_enrollment_actor(
    enrollment: &FreshDeviceEnrollment,
    expected_ptid: &str,
    actor_identity_seed: [u8; 32],
    expected_profile_version: u64,
) -> Result<(), String> {
    let actor_identity = IdentityKeyPair::from_seed(&actor_identity_seed);
    let actor_public_key = actor_identity.verifying_key().to_bytes();
    let actor_fingerprint = Sha256::digest(actor_public_key);
    let certificate = &enrollment.certificate;
    if certificate
        .device
        .as_ref()
        .map(actor_device_ptid)
        .transpose()?
        != Some(expected_ptid)
        || certificate.actor_identity_public_key != actor_public_key
        || certificate.actor_identity_key_fingerprint != actor_fingerprint.as_slice()
        || certificate.observed_profile_version != expected_profile_version
        || certificate.encode_to_vec().is_empty()
    {
        return Err("messaging device identity continuity mismatch".to_string());
    }
    use ed25519_dalek::Verifier;
    actor_identity
        .verifying_key()
        .verify(
            &certificate.encode_to_vec(),
            &ed25519_dalek::Signature::from_bytes(&enrollment.actor_cross_signature),
        )
        .map_err(|_| "messaging device certificate signature mismatch".to_string())
}

pub fn validate_enrollment_response(
    enrollment: &FreshDeviceEnrollment,
    device: &ActorDevice,
) -> Result<(), String> {
    let certificate = &enrollment.certificate;
    if ActorDeviceStatus::try_from(device.status)
        .map_err(|_| "messaging enrollment response status is invalid".to_string())?
        != ActorDeviceStatus::Active
        || device.r#ref.as_ref().map(actor_device_ptid).transpose()?
            != certificate
                .device
                .as_ref()
                .map(actor_device_ptid)
                .transpose()?
        || device
            .r#ref
            .as_ref()
            .map(|endpoint| endpoint.device_id.as_str())
            != certificate
                .device
                .as_ref()
                .map(|endpoint| endpoint.device_id.as_str())
        || device.signing_key_id != certificate.signing_key_id
        || device.profile_version != certificate.observed_profile_version
        || device.actor_identity_key_fingerprint != certificate.actor_identity_key_fingerprint
    {
        return Err("messaging enrollment response binding mismatch".to_string());
    }
    Ok(())
}

pub fn is_stale_endpoint_error(error: &str) -> bool {
    error.contains("endpoint is not active")
        || error.contains("station returned 403")
        || error.contains("Station returned HTTP 403")
        || error.contains("sender_unauthorized")
}

fn build_device_certificate(
    ptid: &str,
    device_id: &str,
    actor_profile_version: u64,
    actor_identity: &IdentityKeyPair,
    device_signing_public_key: &[u8; 32],
) -> ActorDeviceCertificate {
    let actor_public_key = actor_identity.verifying_key().to_bytes();
    let actor_fingerprint = Sha256::digest(actor_public_key);
    let device_fingerprint = Sha256::digest(device_signing_public_key);
    ActorDeviceCertificate {
        format_version: MESSAGING_DEVICE_CERTIFICATE_FORMAT_VERSION,
        device: Some(actor_device_ref(ptid, device_id)),
        actor_identity_public_key: actor_public_key.to_vec(),
        actor_identity_key_fingerprint: actor_fingerprint.to_vec(),
        device_signing_public_key: device_signing_public_key.to_vec(),
        signing_key_id: hex::encode(device_fingerprint),
        observed_profile_version: actor_profile_version,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_enrollment_round_trips() {
        let seed = [42u8; 32];
        let state = generate_fresh_device_identity("alice@p.t", seed, 1).unwrap();
        validate_enrollment_actor(&state.enrollment, "alice@p.t", seed, 1).unwrap();
    }

    #[test]
    fn enrollment_rejects_wrong_ptid() {
        let seed = [42u8; 32];
        let state = generate_fresh_device_identity("alice@p.t", seed, 1).unwrap();
        assert!(validate_enrollment_actor(&state.enrollment, "bob@p.t", seed, 1).is_err());
    }

    #[test]
    fn enrollment_rejects_empty_ptid() {
        assert!(generate_fresh_device_identity("", [1u8; 32], 1).is_err());
    }
}
