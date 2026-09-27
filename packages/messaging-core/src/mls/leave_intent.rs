use crate::proto::chat::{CryptoEndpoint, MlsLeaveIntent, MlsLeaveIntentSigningInput};
use ed25519_dalek::{Signer, SigningKey};
use prost::Message;
use sha2::{Digest, Sha256};
use ulid::Ulid;

pub const MLS_LEAVE_INTENT_VERSION: u32 = 1;
pub const MLS_LEAVE_INTENT_TTL_MS: i64 = 5 * 60 * 1_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MlsLeaveIntentInput {
    pub federation_id: String,
    pub authority_station_peer_id: String,
    pub authority_epoch: i64,
    pub home_station_peer_id: String,
    pub conversation_id: String,
    pub observed_membership_epoch: i64,
    pub observed_mls_epoch: i64,
    pub authority_sequence: i64,
    pub authority_hash: Vec<u8>,
}

pub trait MlsLeaveIntentTransport: Send + Sync {
    fn submit_leave_intent(&self, intent: &MlsLeaveIntent) -> Result<MlsLeaveIntent, String>;

    fn list_leave_intents(&self, conversation_id: &str) -> Result<Vec<MlsLeaveIntent>, String>;
}

pub fn submit_leave_intent<T: MlsLeaveIntentTransport + ?Sized>(
    signing_key_id: &str,
    signing_key: &SigningKey,
    endpoint: &CryptoEndpoint,
    input: &MlsLeaveIntentInput,
    created_at_unix_ms: i64,
    transport: &T,
) -> Result<MlsLeaveIntent, String> {
    let intent_id = Ulid::new().to_string();
    let intent = build_signed_leave_intent(
        signing_key_id,
        signing_key,
        endpoint,
        input,
        &intent_id,
        created_at_unix_ms,
    )?;
    let submitted = transport.submit_leave_intent(&intent)?;
    if submitted != intent {
        return Err("Station returned a different MLS leave intent".to_string());
    }
    Ok(submitted)
}

pub fn list_leave_intents<T: MlsLeaveIntentTransport + ?Sized>(
    conversation_id: &str,
    transport: &T,
) -> Result<Vec<MlsLeaveIntent>, String> {
    if conversation_id.trim().is_empty() {
        return Err("MLS leave intent list requires conversation_id".to_string());
    }
    let intents = transport.list_leave_intents(conversation_id)?;
    if intents
        .iter()
        .any(|intent| intent.conversation_id != conversation_id)
    {
        return Err("Station returned an MLS leave intent for another conversation".to_string());
    }
    Ok(intents)
}

pub fn build_signed_leave_intent(
    signing_key_id: &str,
    signing_key: &SigningKey,
    endpoint: &CryptoEndpoint,
    input: &MlsLeaveIntentInput,
    intent_id: &str,
    created_at_unix_ms: i64,
) -> Result<MlsLeaveIntent, String> {
    validate_endpoint(endpoint)?;
    validate_signing_key(signing_key_id, signing_key)?;
    validate_input(input, intent_id, created_at_unix_ms)?;
    let expires_at_unix_ms = created_at_unix_ms
        .checked_add(MLS_LEAVE_INTENT_TTL_MS)
        .ok_or_else(|| "MLS leave intent expiry overflows".to_string())?;
    let mut intent = MlsLeaveIntent {
        version: MLS_LEAVE_INTENT_VERSION,
        intent_id: intent_id.to_string(),
        federation_id: input.federation_id.clone(),
        authority_station_peer_id: input.authority_station_peer_id.clone(),
        authority_epoch: input.authority_epoch,
        home_station_peer_id: input.home_station_peer_id.clone(),
        conversation_id: input.conversation_id.clone(),
        actor_ptid: endpoint.ptid.clone(),
        actor_device_id: endpoint.device_id.clone(),
        actor_signing_key_id: signing_key_id.to_string(),
        observed_membership_epoch: input.observed_membership_epoch,
        observed_mls_epoch: input.observed_mls_epoch,
        created_at_unix_ms,
        expires_at_unix_ms,
        actor_signature: Vec::new(),
        authority_sequence: input.authority_sequence,
        authority_hash: input.authority_hash.clone(),
    };
    intent.actor_signature = signing_key
        .sign(&leave_intent_signing_bytes(&intent)?)
        .to_bytes()
        .to_vec();
    Ok(intent)
}

pub fn leave_intent_signing_bytes(intent: &MlsLeaveIntent) -> Result<Vec<u8>, String> {
    validate_intent_shape(intent)?;
    Ok(MlsLeaveIntentSigningInput {
        version: intent.version,
        intent_id: intent.intent_id.clone(),
        federation_id: intent.federation_id.clone(),
        authority_station_peer_id: intent.authority_station_peer_id.clone(),
        authority_epoch: intent.authority_epoch,
        home_station_peer_id: intent.home_station_peer_id.clone(),
        conversation_id: intent.conversation_id.clone(),
        actor_ptid: intent.actor_ptid.clone(),
        actor_device_id: intent.actor_device_id.clone(),
        actor_signing_key_id: intent.actor_signing_key_id.clone(),
        observed_membership_epoch: intent.observed_membership_epoch,
        observed_mls_epoch: intent.observed_mls_epoch,
        created_at_unix_ms: intent.created_at_unix_ms,
        expires_at_unix_ms: intent.expires_at_unix_ms,
        authority_sequence: intent.authority_sequence,
        authority_hash: intent.authority_hash.clone(),
    }
    .encode_to_vec())
}

pub fn validate_intent_shape(intent: &MlsLeaveIntent) -> Result<(), String> {
    if intent.version != MLS_LEAVE_INTENT_VERSION
        || intent.intent_id.trim().is_empty()
        || intent.federation_id.trim().is_empty()
        || intent.authority_station_peer_id.trim().is_empty()
        || intent.authority_epoch <= 0
        || intent.home_station_peer_id.trim().is_empty()
        || intent.conversation_id.trim().is_empty()
        || !intent.actor_ptid.starts_with("ptid:")
        || intent.actor_device_id.trim().is_empty()
        || intent.actor_signing_key_id.trim().is_empty()
        || intent.observed_membership_epoch <= 0
        || intent.observed_mls_epoch <= 0
        || intent.authority_sequence <= 0
        || intent.authority_hash.len() != 32
        || intent.created_at_unix_ms <= 0
        || intent.expires_at_unix_ms
            != intent
                .created_at_unix_ms
                .checked_add(MLS_LEAVE_INTENT_TTL_MS)
                .ok_or_else(|| "MLS leave intent expiry overflows".to_string())?
    {
        return Err("MLS leave intent is invalid".to_string());
    }
    Ok(())
}

pub fn validate_signed_leave_intent(intent: &MlsLeaveIntent) -> Result<(), String> {
    validate_intent_shape(intent)?;
    if intent.actor_signature.is_empty() {
        return Err("MLS leave intent signature is empty".to_string());
    }
    Ok(())
}

fn validate_endpoint(endpoint: &CryptoEndpoint) -> Result<(), String> {
    if !endpoint.ptid.starts_with("ptid:") || endpoint.device_id.trim().is_empty() {
        return Err("MLS leave intent requires a canonical actor-device endpoint".to_string());
    }
    Ok(())
}

fn validate_signing_key(signing_key_id: &str, signing_key: &SigningKey) -> Result<(), String> {
    let expected = hex::encode(Sha256::digest(signing_key.verifying_key().as_bytes()));
    if signing_key_id != expected {
        return Err("MLS leave intent signing key ID does not match device key".to_string());
    }
    Ok(())
}

fn validate_input(
    input: &MlsLeaveIntentInput,
    intent_id: &str,
    created_at_unix_ms: i64,
) -> Result<(), String> {
    if intent_id.trim().is_empty()
        || input.federation_id.trim().is_empty()
        || input.authority_station_peer_id.trim().is_empty()
        || input.authority_epoch <= 0
        || input.home_station_peer_id.trim().is_empty()
        || input.conversation_id.trim().is_empty()
        || input.observed_membership_epoch <= 0
        || input.observed_mls_epoch <= 0
        || created_at_unix_ms <= 0
    {
        return Err("MLS leave intent input is invalid".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};
    use std::sync::Mutex;

    struct RecordingTransport {
        submitted: Mutex<Vec<MlsLeaveIntent>>,
        listed: Vec<MlsLeaveIntent>,
    }

    impl MlsLeaveIntentTransport for RecordingTransport {
        fn submit_leave_intent(&self, intent: &MlsLeaveIntent) -> Result<MlsLeaveIntent, String> {
            self.submitted.lock().unwrap().push(intent.clone());
            Ok(intent.clone())
        }

        fn list_leave_intents(
            &self,
            _conversation_id: &str,
        ) -> Result<Vec<MlsLeaveIntent>, String> {
            Ok(self.listed.clone())
        }
    }

    fn input() -> MlsLeaveIntentInput {
        MlsLeaveIntentInput {
            federation_id: "federation-1".to_string(),
            authority_station_peer_id: "station-authority".to_string(),
            authority_epoch: 7,
            home_station_peer_id: "station-home".to_string(),
            conversation_id: "group-1".to_string(),
            observed_membership_epoch: 3,
            observed_mls_epoch: 4,
            authority_sequence: 5,
            authority_hash: vec![7; 32],
        }
    }

    fn signing_identity() -> (String, SigningKey) {
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let signing_key_id = hex::encode(Sha256::digest(signing_key.verifying_key().as_bytes()));
        (signing_key_id, signing_key)
    }

    #[test]
    fn canonical_bytes_are_deterministic_and_signature_verifies() {
        let (signing_key_id, signing_key) = signing_identity();
        let endpoint = CryptoEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };

        let first = build_signed_leave_intent(
            &signing_key_id,
            &signing_key,
            &endpoint,
            &input(),
            "intent-1",
            1_000,
        )
        .unwrap();
        let second = build_signed_leave_intent(
            &signing_key_id,
            &signing_key,
            &endpoint,
            &input(),
            "intent-1",
            1_000,
        )
        .unwrap();
        let signing_bytes = leave_intent_signing_bytes(&first).unwrap();
        let signature = Signature::from_slice(&first.actor_signature).unwrap();

        assert_eq!(first.actor_signing_key_id, signing_key_id);
        assert_eq!(leave_intent_signing_bytes(&second).unwrap(), signing_bytes);
        assert_eq!(second.actor_signature, first.actor_signature);
        signing_key
            .verifying_key()
            .verify(&signing_bytes, &signature)
            .unwrap();
    }

    #[test]
    fn endpoint_signing_key_and_time_validation_fail_closed() {
        let (signing_key_id, signing_key) = signing_identity();
        let invalid_endpoint = CryptoEndpoint {
            ptid: "alice".to_string(),
            device_id: String::new(),
        };

        assert!(build_signed_leave_intent(
            &signing_key_id,
            &signing_key,
            &invalid_endpoint,
            &input(),
            "intent-1",
            1_000,
        )
        .is_err());
        assert!(build_signed_leave_intent(
            "sha256:wrong-key",
            &signing_key,
            &CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            &input(),
            "intent-1",
            1_000,
        )
        .is_err());
        assert!(build_signed_leave_intent(
            &signing_key_id,
            &signing_key,
            &CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            &input(),
            "intent-1",
            0,
        )
        .is_err());
    }

    #[test]
    fn submit_and_list_delegate_through_transport() {
        let (signing_key_id, signing_key) = signing_identity();
        let endpoint = CryptoEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };
        let listed = build_signed_leave_intent(
            &signing_key_id,
            &signing_key,
            &endpoint,
            &input(),
            "intent-listed",
            1_000,
        )
        .unwrap();
        let transport = RecordingTransport {
            submitted: Mutex::new(Vec::new()),
            listed: vec![listed.clone()],
        };

        let submitted = submit_leave_intent(
            &signing_key_id,
            &signing_key,
            &endpoint,
            &input(),
            2_000,
            &transport,
        )
        .unwrap();
        assert_eq!(transport.submitted.lock().unwrap().as_slice(), &[submitted]);
        assert_eq!(
            list_leave_intents("group-1", &transport).unwrap(),
            vec![listed]
        );
    }
}
