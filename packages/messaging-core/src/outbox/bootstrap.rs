use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ulid::Ulid;

use crate::contracts::CryptoEndpoint;
use crate::crypto::identity::IdentityKeyPair;
use crate::crypto::session::{establish_sender_session, DirectSessionKey};
use crate::crypto::x3dh::PreKeyBundle;
use crate::proto::chat::{CryptoEndpoint as ProtoCryptoEndpoint, DirectSessionInit};
use crate::proto::key_exchange::DirectKeyBundle;
use crate::store::DirectOutboundRepository;

use super::DirectSessionBootstrap;

pub trait KeyBundleTransport: Send + Sync {
    fn fetch(&self, endpoint: &ProtoCryptoEndpoint) -> Result<DirectKeyBundle, String>;
}

pub struct DirectSessionBootstrapper<R> {
    store: Arc<R>,
    local: CryptoEndpoint,
    actor_identity: Arc<IdentityKeyPair>,
}

impl<R: DirectOutboundRepository> DirectSessionBootstrapper<R> {
    pub fn new(
        store: Arc<R>,
        local: CryptoEndpoint,
        actor_identity: Arc<IdentityKeyPair>,
    ) -> Result<Self, String> {
        local.validate()?;
        Ok(Self {
            store,
            local,
            actor_identity,
        })
    }

    pub fn prepare_missing<T: KeyBundleTransport>(
        &self,
        conversation_id: &str,
        endpoints: &[ProtoCryptoEndpoint],
        now_unix_ms: i64,
        transport: &T,
    ) -> Result<Vec<DirectSessionBootstrap>, String> {
        if conversation_id.trim().is_empty() || now_unix_ms <= 0 {
            return Err("messaging Direct bootstrap context is incomplete".to_string());
        }
        let mut bootstraps = Vec::new();
        for endpoint in endpoints {
            if endpoint.ptid == self.local.ptid && endpoint.device_id == self.local.device_id {
                continue;
            }
            let peer = CryptoEndpoint::new(endpoint.ptid.clone(), endpoint.device_id.clone())?;
            if self
                .store
                .load_direct_outbound_session(conversation_id, &peer)?
                .is_some()
            {
                continue;
            }
            let wire_bundle = transport.fetch(endpoint)?;
            let bundle = decode_bundle(&wire_bundle)?;
            let generation = self
                .store
                .next_direct_session_generation(conversation_id, &peer)?;
            let session_id = Ulid::new().to_string();
            let (session, x3dh) = establish_sender_session(
                session_id.clone(),
                DirectSessionKey::new(conversation_id, self.local.clone(), peer, generation)?,
                1,
                &self.actor_identity,
                &bundle,
                now_unix_ms,
            )?;
            bootstraps.push(DirectSessionBootstrap {
                session,
                session_init: DirectSessionInit {
                    session_id,
                    conversation_id: conversation_id.to_string(),
                    sender: Some(ProtoCryptoEndpoint {
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

fn decode_bundle(bundle: &DirectKeyBundle) -> Result<PreKeyBundle, String> {
    if bundle.signed_pre_key_id <= 0 {
        return Err("messaging key bundle IDs are invalid".to_string());
    }
    let (opk_pub, opk_id) = match bundle.one_time_pre_keys.first() {
        Some(prekey) if prekey.key_id > 0 => (
            Some(fixed_key(
                "one-time prekey",
                B64.decode(&prekey.public_key)
                    .map_err(|error| error.to_string())?,
            )?),
            Some(
                u32::try_from(prekey.key_id)
                    .map_err(|_| "invalid one-time prekey ID".to_string())?,
            ),
        ),
        None => (None, None),
        _ => return Err("messaging key bundle one-time prekey is invalid".to_string()),
    };
    Ok(PreKeyBundle {
        ik_pub: fixed_key(
            "identity key",
            B64.decode(&bundle.identity_key_public)
                .map_err(|error| error.to_string())?,
        )?,
        spk_pub: fixed_key(
            "signed prekey",
            B64.decode(&bundle.signed_pre_key_public)
                .map_err(|error| error.to_string())?,
        )?,
        spk_sig: B64
            .decode(&bundle.signed_pre_key_signature)
            .map_err(|error| error.to_string())?,
        opk_pub,
        spk_id: u32::try_from(bundle.signed_pre_key_id)
            .map_err(|_| "invalid signed prekey ID".to_string())?,
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
    use ed25519_dalek::Signer;

    use super::*;
    use crate::crypto::identity::X25519KeyPair;
    use crate::store::{DirectOutboundEditCommit, DirectOutboundSendCommit, DirectOutboundSession};

    struct EmptyRepository;

    impl DirectOutboundRepository for EmptyRepository {
        fn validate_sender_attachments_ready(
            &self,
            _conversation_id: &str,
            _message_id: &str,
            _attachments: &[crate::proto::chat::AttachmentPlaintextMetadata],
        ) -> Result<(), String> {
            Ok(())
        }

        fn authority_head(&self, _conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
            Ok((0, Vec::new()))
        }

        fn load_direct_outbound_session(
            &self,
            _conversation_id: &str,
            _peer: &CryptoEndpoint,
        ) -> Result<Option<DirectOutboundSession>, String> {
            Ok(None)
        }

        fn next_direct_session_generation(
            &self,
            _conversation_id: &str,
            _peer: &CryptoEndpoint,
        ) -> Result<u64, String> {
            Ok(1)
        }

        fn persist_direct_outbound_send(
            &self,
            _commit: &DirectOutboundSendCommit<'_>,
        ) -> Result<(), String> {
            Err("unexpected send persistence".to_string())
        }

        fn persist_direct_outbound_edit(
            &self,
            _commit: &DirectOutboundEditCommit<'_>,
        ) -> Result<(), String> {
            Err("unexpected edit persistence".to_string())
        }
    }

    struct FixedTransport(DirectKeyBundle);

    impl KeyBundleTransport for FixedTransport {
        fn fetch(&self, endpoint: &ProtoCryptoEndpoint) -> Result<DirectKeyBundle, String> {
            let device = self.0.device.as_ref().ok_or_else(|| "missing device".to_string())?;
            let actor = device.actor.as_ref().ok_or_else(|| "missing actor".to_string())?;
            if actor.ptid != endpoint.ptid || device.device_id != endpoint.device_id {
                return Err("endpoint mismatch".to_string());
            }
            Ok(self.0.clone())
        }
    }

    #[test]
    fn bootstrap_binds_the_exact_peer_prekey_bundle() {
        let alice = Arc::new(IdentityKeyPair::from_seed(&[21; 32]));
        let bob = IdentityKeyPair::from_seed(&[22; 32]);
        let bob_spk = X25519KeyPair::generate();
        let bob_opk = X25519KeyPair::generate();
        let bootstrapper = DirectSessionBootstrapper::new(
            Arc::new(EmptyRepository),
            CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
            alice,
        )
        .unwrap();
        let peer = ProtoCryptoEndpoint {
            ptid: "ptid:bob".to_string(),
            device_id: "bob-device".to_string(),
        };
        let bootstraps = bootstrapper
            .prepare_missing(
                "conversation-1",
                std::slice::from_ref(&peer),
                100,
                &FixedTransport(DirectKeyBundle {
                    device: Some(crate::proto::actor_device_ref_from_parts(
                        &peer.ptid,
                        &peer.device_id,
                    )),
                    identity_key_public: B64.encode(bob.verifying_key().to_bytes()),
                    signed_pre_key_id: 7,
                    signed_pre_key_public: B64.encode(bob_spk.public_bytes()),
                    signed_pre_key_signature: B64
                        .encode(bob.signing_key().sign(&bob_spk.public_bytes()).to_bytes()),
                    one_time_pre_keys: vec![crate::proto::key_exchange::DirectOneTimePreKey {
                        key_id: 11,
                        public_key: B64.encode(bob_opk.public_bytes()),
                    }],
                    published_at_unix_ms: 1,
                    supported_wire_versions: vec![1],
                }),
            )
            .unwrap();

        assert_eq!(bootstraps.len(), 1);
        assert_eq!(bootstraps[0].session.key.peer.ptid, "ptid:bob");
        assert_eq!(bootstraps[0].session.key.generation, 1);
        assert_eq!(bootstraps[0].session_init.recipient_signed_prekey_id, 7);
        assert_eq!(
            bootstraps[0].session_init.recipient_one_time_prekey_id,
            Some(11)
        );
    }
}
