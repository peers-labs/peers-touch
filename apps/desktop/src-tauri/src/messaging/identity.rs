use crate::domain::crypto::{DeviceSigningKey, IdentityKeyPair};
use crate::model::chat::MessagingDeviceCertificate;
use prost::Message;
use sha2::{Digest, Sha256};
use ulid::Ulid;

pub const MESSAGING_DEVICE_CERTIFICATE_FORMAT_VERSION: u32 = 1;
pub const INITIAL_ACTOR_IDENTITY_PROFILE_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq)]
pub struct FreshDeviceEnrollment {
    pub certificate: MessagingDeviceCertificate,
    pub actor_cross_signature: [u8; 64],
}

pub(super) struct FreshDeviceIdentityState {
    pub enrollment: FreshDeviceEnrollment,
    pub device_signing_seed: [u8; 32],
}

pub(super) fn generate_fresh_device_identity(
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

pub(super) fn validate_enrollment_actor(
    enrollment: &FreshDeviceEnrollment,
    expected_ptid: &str,
    actor_identity_seed: [u8; 32],
    expected_profile_version: u64,
) -> Result<(), String> {
    let actor_identity = IdentityKeyPair::from_seed(&actor_identity_seed);
    let actor_public_key = actor_identity.verifying_key().to_bytes();
    let actor_fingerprint = Sha256::digest(actor_public_key);
    let certificate = &enrollment.certificate;
    if certificate.ptid != expected_ptid
        || certificate.actor_identity_public_key != actor_public_key
        || certificate.actor_identity_key_fingerprint != actor_fingerprint.as_slice()
        || certificate.observed_profile_version != expected_profile_version
        || certificate.encode_to_vec().is_empty()
    {
        return Err("messaging device identity continuity mismatch".to_string());
    }
    actor_identity
        .verifying_key()
        .verify_strict(
            &certificate.encode_to_vec(),
            &ed25519_dalek::Signature::from_bytes(&enrollment.actor_cross_signature),
        )
        .map_err(|_| "messaging device certificate signature mismatch".to_string())
}

fn build_device_certificate(
    ptid: &str,
    device_id: &str,
    actor_profile_version: u64,
    actor_identity: &IdentityKeyPair,
    device_signing_public_key: &[u8; 32],
) -> MessagingDeviceCertificate {
    let actor_public_key = actor_identity.verifying_key().to_bytes();
    let actor_fingerprint = Sha256::digest(actor_public_key);
    let device_fingerprint = Sha256::digest(device_signing_public_key);
    MessagingDeviceCertificate {
        format_version: MESSAGING_DEVICE_CERTIFICATE_FORMAT_VERSION,
        ptid: ptid.to_string(),
        device_id: device_id.to_string(),
        actor_identity_public_key: actor_public_key.to_vec(),
        actor_identity_key_fingerprint: actor_fingerprint.to_vec(),
        device_signing_public_key: device_signing_public_key.to_vec(),
        signing_key_id: hex::encode(device_fingerprint),
        observed_profile_version: actor_profile_version,
    }
}
