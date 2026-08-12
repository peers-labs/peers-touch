use super::{DirectSessionBootstrap, EngineEndpoint, MessagingStore};
use crate::domain::crypto::{
    CryptoEndpoint as SessionEndpoint, DirectSessionKey, IdentityKeyPair, PreKeyBundle,
    SessionManager,
};
use crate::infrastructure::station_client;
use crate::model::chat::{CryptoEndpoint, DirectSessionInit};
use crate::model::key_exchange::{FetchKeyBundleRequest, FetchKeyBundleResponse, KeyBundle};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use reqwest::Method;
use std::sync::Arc;
use ulid::Ulid;

pub trait KeyBundleTransport: Send + Sync {
    fn fetch(&self, endpoint: &CryptoEndpoint) -> Result<KeyBundle, String>;
}

pub struct StationKeyBundleTransport {
    token: String,
    device_id: String,
}

impl StationKeyBundleTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() || device_id.trim().is_empty() {
            return Err("messaging key bundle transport requires token and device ID".to_string());
        }
        Ok(Self { token, device_id })
    }
}

impl KeyBundleTransport for StationKeyBundleTransport {
    fn fetch(&self, endpoint: &CryptoEndpoint) -> Result<KeyBundle, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging key bundle endpoint is incomplete".to_string());
        }
        let response = station_client::request_proto_for_device::<
            FetchKeyBundleRequest,
            FetchKeyBundleResponse,
        >(
            Method::POST,
            "/key-exchange/keys/bundle/fetch",
            &self.token,
            None,
            Some(&FetchKeyBundleRequest {
                did: endpoint.ptid.clone(),
                device_id: endpoint.device_id.clone(),
                home_station_peer_id: String::new(),
            }),
            &self.device_id,
        )
        .map_err(|error| error.to_string())?;
        if response.bundles.len() != 1 {
            return Err("messaging endpoint key bundle is unavailable or ambiguous".to_string());
        }
        let bundle = response
            .bundles
            .into_iter()
            .next()
            .ok_or_else(|| "messaging endpoint key bundle is unavailable".to_string())?;
        if bundle.did != endpoint.ptid || bundle.device_id != endpoint.device_id {
            return Err("messaging endpoint key bundle binding mismatch".to_string());
        }
        Ok(bundle)
    }
}

pub struct DirectSessionBootstrapper {
    store: Arc<MessagingStore>,
    local: EngineEndpoint,
    actor_identity: Arc<IdentityKeyPair>,
}

impl DirectSessionBootstrapper {
    pub fn new(
        store: Arc<MessagingStore>,
        local: EngineEndpoint,
        actor_identity: Arc<IdentityKeyPair>,
    ) -> Result<Self, String> {
        if local.ptid.trim().is_empty() || local.device_id.trim().is_empty() {
            return Err("messaging Direct bootstrapper requires endpoint".to_string());
        }
        Ok(Self {
            store,
            local,
            actor_identity,
        })
    }

    pub fn prepare_missing<T: KeyBundleTransport>(
        &self,
        conversation_id: &str,
        endpoints: &[CryptoEndpoint],
        now_unix_ms: i64,
        transport: &T,
    ) -> Result<Vec<DirectSessionBootstrap>, String> {
        let local = SessionEndpoint::new(self.local.ptid.clone(), self.local.device_id.clone())
            .map_err(|error| error.to_string())?;
        let mut bootstraps = Vec::new();
        for endpoint in endpoints {
            if endpoint.ptid == self.local.ptid && endpoint.device_id == self.local.device_id {
                continue;
            }
            let peer = SessionEndpoint::new(endpoint.ptid.clone(), endpoint.device_id.clone())
                .map_err(|error| error.to_string())?;
            if self
                .store
                .has_established_direct_session(conversation_id, &peer)?
            {
                continue;
            }
            let wire_bundle = transport.fetch(endpoint)?;
            let bundle = decode_bundle(&wire_bundle)?;
            let generation = self
                .store
                .next_direct_session_generation(conversation_id, &peer)?;
            let session_id = Ulid::new().to_string();
            let (session, x3dh) = SessionManager::establish_sender_session(
                session_id.clone(),
                DirectSessionKey::new(conversation_id, local.clone(), peer, generation)
                    .map_err(|error| error.to_string())?,
                1,
                &self.actor_identity,
                &bundle,
                now_unix_ms,
            )
            .map_err(|error| error.to_string())?;
            bootstraps.push(DirectSessionBootstrap {
                session,
                session_init: DirectSessionInit {
                    session_id,
                    conversation_id: conversation_id.to_string(),
                    sender: Some(CryptoEndpoint {
                        ptid: self.local.ptid.clone(),
                        device_id: self.local.device_id.clone(),
                    }),
                    recipient: Some(endpoint.clone()),
                    sender_identity_key: self.actor_identity.verifying_key().to_bytes().to_vec(),
                    sender_ephemeral_key: x3dh.ephemeral_pub.to_vec(),
                    recipient_signed_prekey_id: x3dh.spk_id,
                    recipient_one_time_prekey_id: x3dh.opk_id,
                    protocol_version: 1,
                    session_generation: generation,
                },
            });
        }
        Ok(bootstraps)
    }
}

fn decode_bundle(bundle: &KeyBundle) -> Result<PreKeyBundle, String> {
    if bundle.spk_id <= 0 || bundle.opks.len() != bundle.opk_ids.len() {
        return Err("messaging key bundle IDs are invalid".to_string());
    }
    let (opk_pub, opk_id) = match (bundle.opks.first(), bundle.opk_ids.first()) {
        (Some(public), Some(id)) if *id > 0 => (
            Some(fixed_key(
                "one-time prekey",
                B64.decode(public).map_err(|e| e.to_string())?,
            )?),
            Some(u32::try_from(*id).map_err(|_| "invalid one-time prekey ID".to_string())?),
        ),
        (None, None) => (None, None),
        _ => return Err("messaging key bundle one-time prekey is invalid".to_string()),
    };
    Ok(PreKeyBundle {
        ik_pub: fixed_key(
            "identity key",
            B64.decode(&bundle.ik_pub)
                .map_err(|error| error.to_string())?,
        )?,
        spk_pub: fixed_key(
            "signed prekey",
            B64.decode(&bundle.spk_pub)
                .map_err(|error| error.to_string())?,
        )?,
        spk_sig: B64
            .decode(&bundle.spk_sig)
            .map_err(|error| error.to_string())?,
        opk_pub,
        spk_id: u32::try_from(bundle.spk_id).map_err(|_| "invalid signed prekey ID".to_string())?,
        opk_id,
    })
}

fn fixed_key(label: &str, value: Vec<u8>) -> Result<[u8; 32], String> {
    value
        .try_into()
        .map_err(|value: Vec<u8>| format!("{label}: expected 32 bytes, got {}", value.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::crypto::{X25519KeyPair, X3dhReceiverInput};
    use ed25519_dalek::Signer;

    struct FixedTransport(KeyBundle);

    impl KeyBundleTransport for FixedTransport {
        fn fetch(&self, _: &CryptoEndpoint) -> Result<KeyBundle, String> {
            Ok(self.0.clone())
        }
    }

    #[test]
    fn sender_bootstrap_binds_prekeys_and_derives_receiver_ratchet() {
        let alice = Arc::new(IdentityKeyPair::from_seed(&[21; 32]));
        let bob = IdentityKeyPair::from_seed(&[22; 32]);
        let bob_spk = X25519KeyPair::generate();
        let bob_opk = X25519KeyPair::generate();
        let transport = FixedTransport(KeyBundle {
            did: "ptid:bob".to_string(),
            device_id: "bob-device".to_string(),
            ik_pub: B64.encode(bob.verifying_key().to_bytes()),
            spk_pub: B64.encode(bob_spk.public_bytes()),
            spk_sig: B64.encode(bob.signing_key().sign(&bob_spk.public_bytes()).to_bytes()),
            opks: vec![B64.encode(bob_opk.public_bytes())],
            published_at_unix_ms: 1,
            supported_versions: vec![1],
            spk_id: 7,
            opk_ids: vec![11],
        });
        let bootstrapper = DirectSessionBootstrapper::new(
            Arc::new(MessagingStore::in_memory().unwrap()),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            alice,
        )
        .unwrap();
        let bootstraps = bootstrapper
            .prepare_missing(
                "conversation-1",
                &[CryptoEndpoint {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                }],
                100,
                &transport,
            )
            .unwrap();
        assert_eq!(bootstraps.len(), 1);
        let bootstrap = &bootstraps[0];
        assert!(!bootstrap.session.established);
        assert_eq!(bootstrap.session_init.recipient_signed_prekey_id, 7);
        assert_eq!(
            bootstrap.session_init.recipient_one_time_prekey_id,
            Some(11)
        );
        let receiver = SessionManager::establish_receiver_session(
            bootstrap.session.session_id.clone(),
            DirectSessionKey::new(
                "conversation-1",
                SessionEndpoint::new("ptid:bob", "bob-device").unwrap(),
                SessionEndpoint::new("ptid:alice", "alice-device").unwrap(),
                1,
            )
            .unwrap(),
            1,
            &bob,
            &bob_spk,
            Some(&bob_opk),
            &X3dhReceiverInput {
                sender_ik_pub: fixed_key(
                    "sender IK",
                    bootstrap.session_init.sender_identity_key.clone(),
                )
                .unwrap(),
                sender_ephemeral_pub: fixed_key(
                    "sender ephemeral",
                    bootstrap.session_init.sender_ephemeral_key.clone(),
                )
                .unwrap(),
                spk_id: 7,
                opk_id: Some(11),
            },
            100,
        )
        .unwrap();
        let mut sender_ratchet = bootstrap.session.ratchet.clone();
        let ciphertext = crate::domain::crypto::double_ratchet::encrypt(
            &mut sender_ratchet,
            b"exact first plaintext",
            b"bound aad",
        )
        .unwrap();
        let decrypted = crate::domain::crypto::double_ratchet::decrypt(
            &receiver.ratchet,
            &ciphertext,
            &[],
            b"bound aad",
        )
        .unwrap();
        assert_eq!(decrypted.plaintext, b"exact first plaintext");
    }
}
