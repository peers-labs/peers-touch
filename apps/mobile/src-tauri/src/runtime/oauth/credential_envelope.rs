use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use prost::Message;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

use super::proto::auth::v1::LoginResponse;
use super::proto::oauth::mobile::v1::OAuthCredentialEnvelope;
use crate::error::{MobileError, MobileResult};

const CREDENTIAL_ENVELOPE_DOMAIN: &str = "peers-touch/oauth-credential-envelope";
const X25519_KEY_SIZE: usize = 32;
const AES_256_KEY_SIZE: usize = 32;
const AES_GCM_NONCE_SIZE: usize = 12;
const AES_GCM_TAG_SIZE: usize = 16;

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct NativeSessionCredential {
    pub(crate) session_id: String,
    pub(crate) actor_ptid: String,
    pub(crate) legacy_token: String,
    pub(crate) access_token: String,
    pub(crate) refresh_token: String,
    pub(crate) token_type: String,
    pub(crate) expires_at: String,
}

pub(crate) fn decrypt_credential_envelope(
    envelope: &OAuthCredentialEnvelope,
    access_attempt_id: &str,
    decision_revision: u64,
    client_private_key: &[u8; X25519_KEY_SIZE],
) -> MobileResult<NativeSessionCredential> {
    validate_envelope(envelope, access_attempt_id)?;

    let server_public_key: [u8; X25519_KEY_SIZE] = envelope
        .server_ephemeral_public_key
        .as_slice()
        .try_into()
        .map_err(|_| envelope_error("invalidServerPublicKey"))?;
    let client_private_key = StaticSecret::from(*client_private_key);
    let shared_secret = client_private_key.diffie_hellman(&PublicKey::from(server_public_key));
    if !bool::from(shared_secret.was_contributory()) {
        return Err(envelope_error("invalidSharedSecret"));
    }

    let associated_data = credential_envelope_associated_data(
        &envelope.candidate_id,
        &envelope.session_id,
        &envelope.station_peer_id,
        &envelope.device_id,
        envelope.lifecycle_generation,
        access_attempt_id,
        decision_revision,
    )?;
    let key = Zeroizing::new(derive_envelope_key(
        shared_secret.as_bytes(),
        &associated_data,
    )?);
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| envelope_error("invalidEncryptionKey"))?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&envelope.nonce),
                Payload {
                    msg: &envelope.ciphertext,
                    aad: &associated_data,
                },
            )
            .map_err(|_| envelope_error("authenticationFailed"))?,
    );
    let credential = LoginResponse::decode(plaintext.as_slice())
        .map_err(|_| envelope_error("invalidCredentialPayload"))?;

    native_credential(envelope, credential)
}

fn validate_envelope(
    envelope: &OAuthCredentialEnvelope,
    access_attempt_id: &str,
) -> MobileResult<()> {
    if envelope.candidate_id.is_empty()
        || envelope.session_id.is_empty()
        || envelope.station_peer_id.is_empty()
        || envelope.device_id.is_empty()
        || access_attempt_id.is_empty()
    {
        return Err(envelope_error("missingBinding"));
    }
    if envelope.server_ephemeral_public_key.len() != X25519_KEY_SIZE {
        return Err(envelope_error("invalidServerPublicKey"));
    }
    if envelope.nonce.len() != AES_GCM_NONCE_SIZE {
        return Err(envelope_error("invalidNonce"));
    }
    if envelope.ciphertext.len() < AES_GCM_TAG_SIZE {
        return Err(envelope_error("invalidCiphertext"));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn credential_envelope_associated_data(
    candidate_id: &str,
    session_id: &str,
    station_peer_id: &str,
    device_id: &str,
    lifecycle_generation: u64,
    access_attempt_id: &str,
    decision_revision: u64,
) -> MobileResult<Vec<u8>> {
    let values = [
        CREDENTIAL_ENVELOPE_DOMAIN,
        candidate_id,
        session_id,
        station_peer_id,
        device_id,
        access_attempt_id,
    ];
    let strings_size = values.iter().try_fold(0_usize, |total, value| {
        u32::try_from(value.len())
            .map(|_| total + 4 + value.len())
            .map_err(|_| envelope_error("bindingTooLong"))
    })?;
    let mut encoded = Vec::with_capacity(strings_size + 16);
    for value in values {
        let length = u32::try_from(value.len()).map_err(|_| envelope_error("bindingTooLong"))?;
        encoded.extend_from_slice(&length.to_be_bytes());
        encoded.extend_from_slice(value.as_bytes());
    }
    encoded.extend_from_slice(&lifecycle_generation.to_be_bytes());
    encoded.extend_from_slice(&decision_revision.to_be_bytes());
    Ok(encoded)
}

fn derive_envelope_key(
    shared_secret: &[u8; X25519_KEY_SIZE],
    associated_data: &[u8],
) -> MobileResult<[u8; AES_256_KEY_SIZE]> {
    let mut key = [0_u8; AES_256_KEY_SIZE];
    Hkdf::<Sha256>::new(None, shared_secret)
        .expand(associated_data, &mut key)
        .map_err(|_| envelope_error("keyDerivationFailed"))?;
    Ok(key)
}

fn native_credential(
    envelope: &OAuthCredentialEnvelope,
    credential: LoginResponse,
) -> MobileResult<NativeSessionCredential> {
    if credential.session_id != envelope.session_id {
        return Err(envelope_error("sessionMismatch"));
    }
    let actor_ref = credential
        .actor_ref
        .ok_or_else(|| envelope_error("missingActor"))?;
    let envelope_actor_ref = envelope
        .actor_ref
        .as_ref()
        .ok_or_else(|| envelope_error("missingEnvelopeActor"))?;
    if actor_ref != *envelope_actor_ref || actor_ref.ptid.is_empty() {
        return Err(envelope_error("actorMismatch"));
    }
    let tokens = credential
        .tokens
        .ok_or_else(|| envelope_error("missingTokens"))?;
    if tokens.access_token.is_empty() {
        return Err(envelope_error("missingAccessToken"));
    }

    Ok(NativeSessionCredential {
        session_id: credential.session_id,
        actor_ptid: actor_ref.ptid,
        legacy_token: tokens.token,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_at: tokens.expires_at,
    })
}

fn envelope_error(reason: &str) -> MobileError {
    MobileError::crypto(format!("mobile.auth.oauthCredentialEnvelope:{reason}"))
}

#[cfg(test)]
mod tests {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use serde::Deserialize;

    use super::super::proto::actor::v1::{ActorKind, ActorRef};
    use super::*;

    #[derive(Clone, Deserialize)]
    struct GoCredentialEnvelopeFixture {
        candidate_id: String,
        session_id: String,
        actor_ptid: String,
        station_peer_id: String,
        device_id: String,
        lifecycle_generation: u64,
        access_attempt_id: String,
        decision_revision: u64,
        client_private_key: String,
        server_ephemeral_public_key: String,
        nonce: String,
        ciphertext: String,
        expected_access_token: String,
        expected_refresh_token: String,
    }

    impl GoCredentialEnvelopeFixture {
        fn load() -> Self {
            serde_json::from_str(include_str!("fixtures/credential_envelope_go.json"))
                .expect("Go credential-envelope fixture must decode")
        }

        fn envelope(&self) -> OAuthCredentialEnvelope {
            OAuthCredentialEnvelope {
                candidate_id: self.candidate_id.clone(),
                session_id: self.session_id.clone(),
                actor_ref: Some(ActorRef {
                    ptid: self.actor_ptid.clone(),
                    acct: String::new(),
                    kind: ActorKind::Person as i32,
                }),
                station_peer_id: self.station_peer_id.clone(),
                device_id: self.device_id.clone(),
                lifecycle_generation: self.lifecycle_generation,
                server_ephemeral_public_key: decode_base64(&self.server_ephemeral_public_key),
                nonce: decode_base64(&self.nonce),
                ciphertext: decode_base64(&self.ciphertext),
                expires_at: None,
            }
        }

        fn private_key(&self) -> [u8; X25519_KEY_SIZE] {
            decode_base64(&self.client_private_key)
                .try_into()
                .expect("fixture private key must be 32 bytes")
        }

        fn decrypt(
            &self,
            envelope: &OAuthCredentialEnvelope,
        ) -> MobileResult<NativeSessionCredential> {
            decrypt_credential_envelope(
                envelope,
                &self.access_attempt_id,
                self.decision_revision,
                &self.private_key(),
            )
        }
    }

    fn decode_base64(value: &str) -> Vec<u8> {
        STANDARD.decode(value).expect("fixture base64 must decode")
    }

    #[test]
    fn decrypts_canonical_go_credential_envelope() {
        let fixture = GoCredentialEnvelopeFixture::load();
        let credential = fixture
            .decrypt(&fixture.envelope())
            .expect("canonical Go envelope must decrypt");

        assert_eq!(credential.session_id, fixture.session_id);
        assert_eq!(credential.actor_ptid, fixture.actor_ptid);
        assert_eq!(credential.legacy_token, fixture.expected_access_token);
        assert_eq!(credential.access_token, fixture.expected_access_token);
        assert_eq!(credential.refresh_token, fixture.expected_refresh_token);
        assert_eq!(credential.token_type, "Bearer");
        assert_eq!(credential.expires_at, "2030-01-02T03:04:05Z");
    }

    #[test]
    fn rejects_every_authenticated_binding_mismatch() {
        let fixture = GoCredentialEnvelopeFixture::load();
        let cases: &[(&str, fn(&mut OAuthCredentialEnvelope))] = &[
            ("candidate", |envelope| envelope.candidate_id.push('x')),
            ("session", |envelope| envelope.session_id.push('x')),
            ("station", |envelope| envelope.station_peer_id.push('x')),
            ("device", |envelope| envelope.device_id.push('x')),
            ("generation", |envelope| envelope.lifecycle_generation += 1),
        ];

        for (name, mutate) in cases {
            let mut envelope = fixture.envelope();
            mutate(&mut envelope);
            assert!(
                fixture.decrypt(&envelope).is_err(),
                "{name} mismatch must fail"
            );
        }

        let envelope = fixture.envelope();
        assert!(decrypt_credential_envelope(
            &envelope,
            "wrong-access-attempt",
            fixture.decision_revision,
            &fixture.private_key(),
        )
        .is_err());
        assert!(decrypt_credential_envelope(
            &envelope,
            &fixture.access_attempt_id,
            fixture.decision_revision + 1,
            &fixture.private_key(),
        )
        .is_err());
    }

    #[test]
    fn rejects_wrong_key_nonce_and_ciphertext() {
        let fixture = GoCredentialEnvelopeFixture::load();
        let envelope = fixture.envelope();
        let mut wrong_key = fixture.private_key();
        wrong_key[0] ^= 0x80;
        assert!(decrypt_credential_envelope(
            &envelope,
            &fixture.access_attempt_id,
            fixture.decision_revision,
            &wrong_key,
        )
        .is_err());

        let mut wrong_nonce = fixture.envelope();
        wrong_nonce.nonce[0] ^= 0x80;
        assert!(fixture.decrypt(&wrong_nonce).is_err());

        let mut wrong_ciphertext = fixture.envelope();
        wrong_ciphertext.ciphertext[0] ^= 0x80;
        assert!(fixture.decrypt(&wrong_ciphertext).is_err());
    }
}
