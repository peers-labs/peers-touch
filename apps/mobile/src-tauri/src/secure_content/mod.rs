pub mod adapter;
pub mod proto;
pub mod receiver;
pub mod store;
pub mod transport;
pub mod worker;

use ed25519_dalek::VerifyingKey;
use messaging_core::identity::DeviceSigningKey;
use zeroize::Zeroizing;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrivateSocialScope {
    pub profile_id: String,
    pub station_peer_id: String,
    pub station_origin: String,
    pub actor_ptid: String,
    pub device_id: String,
}

pub struct TrustedStationSigningKey {
    pub key_id: String,
    pub verifying_key: VerifyingKey,
}

pub struct NativeSocialSession {
    pub scope: PrivateSocialScope,
    pub jwt_session_id: String,
    pub signing_key_id: String,
    pub profile_version: u64,
    pub device_signing_key: DeviceSigningKey,
    pub trusted_station_signing_key: TrustedStationSigningKey,
    access_token: Zeroizing<String>,
}

impl NativeSocialSession {
    pub fn new(
        scope: PrivateSocialScope,
        access_token: Zeroizing<String>,
        jwt_session_id: String,
        signing_key_id: String,
        profile_version: u64,
        device_signing_key: DeviceSigningKey,
        trusted_station_signing_key: TrustedStationSigningKey,
    ) -> Result<Self, String> {
        if scope.profile_id.trim().is_empty()
            || scope.station_peer_id.trim().is_empty()
            || scope.station_origin.trim().is_empty()
            || scope.actor_ptid.trim().is_empty()
            || scope.device_id.trim().is_empty()
            || access_token.trim().is_empty()
            || jwt_session_id.trim().is_empty()
            || signing_key_id.trim().is_empty()
            || profile_version == 0
            || device_signing_key.device_id() != scope.device_id
        {
            return Err("private Social Native session identity is incomplete".to_string());
        }
        Ok(Self {
            scope,
            jwt_session_id,
            signing_key_id,
            profile_version,
            device_signing_key,
            trusted_station_signing_key,
            access_token,
        })
    }

    pub fn access_token(&self) -> &str {
        self.access_token.as_str()
    }

    pub fn sign(&self, payload: &[u8]) -> Vec<u8> {
        self.device_signing_key.sign(payload).to_bytes().to_vec()
    }
}
