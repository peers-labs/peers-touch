use data_encoding::BASE32_NOPAD;
use ed25519_dalek::pkcs8::{DecodePublicKey, EncodePublicKey};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use prost::Message;
use reqwest::Method;
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::infrastructure::station_client;
use crate::infrastructure::station_registry::StationRegistry;
use crate::model::actor::{ActorDeviceRef, ActorSigningKeyVerificationSource};
use crate::model::federation::ActorProfileEnvelope;
use crate::secure_content::SecureContentSession;

const PROFILE_MAX_LIFETIME_MS: i64 = 60 * 60 * 1_000;
const PROFILE_CLOCK_SKEW_MS: i64 = 30_000;
const FEDERATION_KEY_ID_LENGTH: usize = 26;

#[derive(Clone)]
pub struct TrustedStationSigningKey {
    pub key_id: String,
    pub verifying_key: VerifyingKey,
}

pub fn current_session_sender_signing_key(
    session: &SecureContentSession,
    sender: &ActorDeviceRef,
    signing_key_id: &str,
) -> Result<Option<VerifyingKey>, String> {
    if sender.actor.as_ref().map(|actor| actor.ptid.as_str())
        != Some(session.key.actor_ptid.as_str())
        || sender.device_id != session.key.device_id
        || signing_key_id != session.signing_key_id
    {
        return Ok(None);
    }
    let secrets = session.begin_request()?;
    secrets
        .secrets
        .signing_key
        .as_ref()
        .map(|key| Some(key.verifying_key()))
        .ok_or_else(|| "Secure Content sender signing key is unavailable".to_string())
}

pub fn verify_profile_actor_device_signing_key(
    envelope: &ActorProfileEnvelope,
    trusted_station: &TrustedStationSigningKey,
    expected_handle: &str,
    expected_station_peer_id: &str,
    expected_sender: &ActorDeviceRef,
    expected_signing_key_id: &str,
    committed_at_unix_ms: i64,
    now_unix_ms: i64,
) -> Result<VerifyingKey, String> {
    let profile_station = verify_profile_envelope(
        envelope,
        expected_handle,
        expected_station_peer_id,
        now_unix_ms,
    )?;
    if profile_station.key_id != trusted_station.key_id
        || profile_station.verifying_key != trusted_station.verifying_key
    {
        return Err("Actor profile is not signed by the pinned Station key".to_string());
    }
    let actor = expected_sender
        .actor
        .as_ref()
        .ok_or_else(|| "Secure Content sender actor is unavailable".to_string())?;
    let profile_ptid = envelope
        .profile
        .as_ref()
        .and_then(|profile| profile.peers_touch.as_ref())
        .map(|identity| identity.network_id.as_str())
        .unwrap_or_default();
    if actor.ptid.trim().is_empty()
        || profile_ptid != actor.ptid
        || expected_sender.device_id.trim().is_empty()
        || expected_signing_key_id.trim().is_empty()
        || committed_at_unix_ms <= 0
    {
        return Err("Actor profile sender identity is invalid".to_string());
    }

    let mut matches = envelope.device_signing_keys.iter().filter(|key| {
        key.actor_ptid == actor.ptid
            && key.actor_device_id == expected_sender.device_id
            && key.home_station_peer_id == expected_station_peer_id
            && key.signing_key_id == expected_signing_key_id
    });
    let key = matches.next().ok_or_else(|| {
        "Actor profile does not expose the required sender signing key".to_string()
    })?;
    if matches.next().is_some()
        || key.ed25519_public_key.len() != 32
        || key.profile_version <= 0
        || key.valid_from_unix_ms <= 0
        || key.valid_from_unix_ms > committed_at_unix_ms
        || (key.revoked_at_unix_ms != 0
            && (key.revoked_at_unix_ms <= key.valid_from_unix_ms
                || committed_at_unix_ms >= key.revoked_at_unix_ms))
        || !matches!(
            ActorSigningKeyVerificationSource::try_from(key.verification_source).ok(),
            Some(ActorSigningKeyVerificationSource::VerifiedProfile)
                | Some(ActorSigningKeyVerificationSource::VerifiedLocator)
        )
    {
        return Err("Actor profile sender signing key is not valid at commit time".to_string());
    }
    VerifyingKey::from_bytes(
        key.ed25519_public_key
            .as_slice()
            .try_into()
            .map_err(|_| "Actor profile sender signing key is invalid".to_string())?,
    )
    .map_err(|_| "Actor profile sender signing key is invalid".to_string())
}

pub fn resolve_station_signing_key(
    registry: &StationRegistry,
    station_url: &str,
    station_peer_id: &str,
    actor_handle: &str,
    token: &str,
    device_id: &str,
) -> Result<TrustedStationSigningKey, String> {
    require_authenticated_station_transport(station_url)?;
    if let Some(pin) = registry
        .federation_signing_key_pin(station_url)
        .map_err(|error| format!("load Station Federation signing-key pin: {error}"))?
    {
        if pin.station_peer_id != station_peer_id {
            return Err("pinned Station Federation key belongs to another peer".to_string());
        }
        let verifying_key = VerifyingKey::from_bytes(&pin.ed25519_public_key)
            .map_err(|_| "pinned Station Federation signing key is invalid".to_string())?;
        return Ok(TrustedStationSigningKey {
            key_id: pin.signing_key_id,
            verifying_key,
        });
    }

    let query = [("handle", actor_handle.to_string())];
    let envelope: ActorProfileEnvelope =
        station_client::request_proto_for_device_at::<(), ActorProfileEnvelope>(
            station_url,
            Method::GET,
            "/actor/federation/profile",
            token,
            Some(&query),
            None,
            device_id,
        )
        .map_err(|error| format!("load Station Federation profile: {error}"))?;
    let trusted =
        verify_profile_envelope(&envelope, actor_handle, station_peer_id, current_unix_ms())?;
    registry
        .pin_or_verify_federation_signing_key(
            station_url,
            station_peer_id,
            &trusted.key_id,
            trusted.verifying_key.to_bytes(),
        )
        .map_err(|error| format!("pin Station Federation signing key: {error}"))?;
    Ok(trusted)
}

fn require_authenticated_station_transport(station_url: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(station_url)
        .map_err(|_| "Secure Content Station URL is invalid".to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "Secure Content Station URL has no host".to_string())?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false);
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(
            "Secure Content first-use Station trust requires HTTPS or loopback HTTP".to_string(),
        );
    }
    Ok(())
}

fn verify_profile_envelope(
    envelope: &ActorProfileEnvelope,
    expected_handle: &str,
    expected_station_peer_id: &str,
    now_unix_ms: i64,
) -> Result<TrustedStationSigningKey, String> {
    if expected_handle.trim().is_empty()
        || envelope.federated_handle != expected_handle
        || envelope.home_station_peer_id != expected_station_peer_id
        || envelope.home_station_domain.trim().is_empty()
        || envelope.profile.is_none()
        || envelope.signing_key_pem.trim().is_empty()
        || envelope.signing_key_kid.trim().is_empty()
        || envelope.signature.len() != 64
    {
        return Err("Station Federation profile identity is invalid".to_string());
    }
    if envelope.expires_at_unix_ms <= envelope.issued_at_unix_ms
        || envelope
            .expires_at_unix_ms
            .saturating_sub(envelope.issued_at_unix_ms)
            > PROFILE_MAX_LIFETIME_MS
        || envelope.issued_at_unix_ms > now_unix_ms.saturating_add(PROFILE_CLOCK_SKEW_MS)
        || envelope.expires_at_unix_ms < now_unix_ms.saturating_sub(PROFILE_CLOCK_SKEW_MS)
    {
        return Err("Station Federation profile is stale".to_string());
    }

    let verifying_key = VerifyingKey::from_public_key_pem(&envelope.signing_key_pem)
        .map_err(|_| "Station Federation profile signing key is invalid".to_string())?;
    let derived_key_id = federation_signing_key_id(&verifying_key)?;
    if envelope.signing_key_kid != derived_key_id {
        return Err("Station Federation profile signing-key fingerprint mismatched".to_string());
    }

    let signature = Signature::from_slice(&envelope.signature)
        .map_err(|_| "Station Federation profile signature is invalid".to_string())?;
    let mut unsigned = envelope.clone();
    unsigned.signature.clear();
    verifying_key
        .verify(&unsigned.encode_to_vec(), &signature)
        .map_err(|_| "Station Federation profile signature is invalid".to_string())?;

    Ok(TrustedStationSigningKey {
        key_id: derived_key_id,
        verifying_key,
    })
}

fn federation_signing_key_id(key: &VerifyingKey) -> Result<String, String> {
    let document = key
        .to_public_key_der()
        .map_err(|_| "encode Station Federation signing key".to_string())?;
    let encoded = BASE32_NOPAD.encode(&Sha256::digest(document.as_bytes()));
    Ok(encoded[..FEDERATION_KEY_ID_LENGTH].to_ascii_lowercase())
}

fn current_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn signed_profile(
        signing_key: &SigningKey,
        handle: &str,
        station_peer_id: &str,
        now_unix_ms: i64,
    ) -> ActorProfileEnvelope {
        let verifying_key = signing_key.verifying_key();
        let mut envelope = ActorProfileEnvelope {
            federated_handle: handle.to_string(),
            home_station_peer_id: station_peer_id.to_string(),
            home_station_domain: "station.test:443".to_string(),
            profile: Some(crate::model::actor::ActorProfile {
                peers_touch: Some(crate::model::actor::PeersTouchInfo {
                    network_id: "ptid:alice".to_string(),
                }),
                ..Default::default()
            }),
            issued_at_unix_ms: now_unix_ms,
            expires_at_unix_ms: now_unix_ms + 300_000,
            signature: Vec::new(),
            signing_key_pem: verifying_key.to_public_key_pem(Default::default()).unwrap(),
            signing_key_kid: federation_signing_key_id(&verifying_key).unwrap(),
            device_signing_keys: Vec::new(),
        };
        envelope.signature = signing_key
            .sign(&envelope.encode_to_vec())
            .to_bytes()
            .to_vec();
        envelope
    }

    fn resign_profile(envelope: &mut ActorProfileEnvelope, signing_key: &SigningKey) {
        envelope.signature.clear();
        envelope.signature = signing_key
            .sign(&envelope.encode_to_vec())
            .to_bytes()
            .to_vec();
    }

    fn sender_key(
        signing_key: &SigningKey,
        revoked_at_unix_ms: i64,
    ) -> crate::model::actor::VerifiedActorDeviceSigningKey {
        crate::model::actor::VerifiedActorDeviceSigningKey {
            actor_ptid: "ptid:alice".to_string(),
            actor_device_id: "device-1".to_string(),
            home_station_peer_id: "station-1".to_string(),
            signing_key_id: "sender-key-1".to_string(),
            ed25519_public_key: signing_key.verifying_key().to_bytes().to_vec(),
            profile_version: 7,
            verification_source: ActorSigningKeyVerificationSource::VerifiedProfile as i32,
            valid_from_unix_ms: 1_800_000_000_000,
            revoked_at_unix_ms,
        }
    }

    fn sender() -> ActorDeviceRef {
        ActorDeviceRef {
            actor: Some(crate::model::actor::ActorRef {
                ptid: "ptid:alice".to_string(),
                acct: "@alice@station.test".to_string(),
                kind: crate::model::actor::ActorKind::Person as i32,
            }),
            device_id: "device-1".to_string(),
        }
    }

    #[test]
    fn verifies_profile_key_identity_before_returning_trust_anchor() {
        let now = 1_900_000_000_000;
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let envelope = signed_profile(&signing_key, "@alice@station.test", "station-1", now);

        let trusted =
            verify_profile_envelope(&envelope, "@alice@station.test", "station-1", now).unwrap();

        assert_eq!(trusted.key_id, envelope.signing_key_kid);
        assert_eq!(trusted.verifying_key, signing_key.verifying_key());
    }

    #[test]
    fn rejects_profile_signed_by_a_substituted_key_or_station() {
        let now = 1_900_000_000_000;
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let mut envelope = signed_profile(&signing_key, "@alice@station.test", "station-1", now);
        envelope.home_station_peer_id = "station-attacker".to_string();

        assert!(
            verify_profile_envelope(&envelope, "@alice@station.test", "station-1", now).is_err()
        );

        let attacker = SigningKey::from_bytes(&[8; 32]);
        envelope = signed_profile(&signing_key, "@alice@station.test", "station-1", now);
        envelope.signature = attacker
            .sign(&{
                let mut unsigned = envelope.clone();
                unsigned.signature.clear();
                unsigned.encode_to_vec()
            })
            .to_bytes()
            .to_vec();
        assert!(
            verify_profile_envelope(&envelope, "@alice@station.test", "station-1", now).is_err()
        );
    }

    #[test]
    fn secure_content_profile_sender_key_is_exact_and_commit_time_bound() {
        let now = 1_900_000_000_000;
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let device_key = SigningKey::from_bytes(&[8; 32]);
        let mut envelope = signed_profile(&station_key, "@alice@station.test", "station-1", now);
        envelope.device_signing_keys = vec![sender_key(&device_key, now - 10_000)];
        resign_profile(&mut envelope, &station_key);
        let trusted = TrustedStationSigningKey {
            key_id: federation_signing_key_id(&station_key.verifying_key()).unwrap(),
            verifying_key: station_key.verifying_key(),
        };

        assert_eq!(
            verify_profile_actor_device_signing_key(
                &envelope,
                &trusted,
                "@alice@station.test",
                "station-1",
                &sender(),
                "sender-key-1",
                now - 20_000,
                now,
            )
            .unwrap(),
            device_key.verifying_key()
        );
        assert!(verify_profile_actor_device_signing_key(
            &envelope,
            &trusted,
            "@alice@station.test",
            "station-1",
            &sender(),
            "sender-key-1",
            now,
            now,
        )
        .is_err());
        assert!(verify_profile_actor_device_signing_key(
            &envelope,
            &trusted,
            "@alice@station.test",
            "station-1",
            &sender(),
            "sender-key-substituted",
            now - 20_000,
            now,
        )
        .is_err());
    }

    #[test]
    fn secure_content_profile_rejects_substituted_sender_key() {
        let now = 1_900_000_000_000;
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let device_key = SigningKey::from_bytes(&[8; 32]);
        let attacker_key = SigningKey::from_bytes(&[6; 32]);
        let mut envelope = signed_profile(&station_key, "@alice@station.test", "station-1", now);
        envelope.device_signing_keys = vec![sender_key(&device_key, 0)];
        resign_profile(&mut envelope, &station_key);
        envelope.device_signing_keys[0].ed25519_public_key =
            attacker_key.verifying_key().to_bytes().to_vec();
        let trusted = TrustedStationSigningKey {
            key_id: federation_signing_key_id(&station_key.verifying_key()).unwrap(),
            verifying_key: station_key.verifying_key(),
        };

        assert!(verify_profile_actor_device_signing_key(
            &envelope,
            &trusted,
            "@alice@station.test",
            "station-1",
            &sender(),
            "sender-key-1",
            now - 1,
            now,
        )
        .is_err());
    }

    #[test]
    fn secure_content_station_trust_rejects_remote_plaintext_transport() {
        assert!(require_authenticated_station_transport("https://station.test").is_ok());
        assert!(require_authenticated_station_transport("http://127.0.0.1:18080").is_ok());
        assert!(require_authenticated_station_transport("http://localhost:18080").is_ok());
        assert!(require_authenticated_station_transport("http://station.test").is_err());
        assert!(require_authenticated_station_transport("ftp://station.test").is_err());
    }
}
