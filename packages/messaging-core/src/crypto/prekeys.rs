use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ed25519_dalek::Signer;

use super::identity::{IdentityKeyPair, X25519KeyPair};
use crate::contracts::CryptoEndpoint;
use crate::proto::actor_device_ref;
use crate::proto::key_exchange::{DirectOneTimePreKey, UploadDirectKeyBundleRequest};

const INITIAL_ONE_TIME_PREKEY_COUNT: i32 = 20;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingPreKeyBundle {
    pub signed_prekey_id: i32,
    pub signed_prekey_private: [u8; 32],
    pub one_time_prekeys: Vec<(i32, [u8; 32])>,
}

pub trait PreKeyRepository: Send + Sync {
    fn has_prekey_bundle(&self) -> Result<bool, String>;

    fn install_fresh_prekey_bundle(
        &self,
        signed_prekey_id: i32,
        signed_prekey_private: &[u8; 32],
        one_time_prekeys: &[(i32, [u8; 32])],
        created_at_unix_ms: i64,
    ) -> Result<(), String>;

    fn pending_prekey_bundle(&self) -> Result<Option<PendingPreKeyBundle>, String>;

    fn complete_prekey_publication(&self, signed_prekey_id: i32) -> Result<(), String>;
}

pub trait PreKeyTransport: Send + Sync {
    fn upload(&self, request: &UploadDirectKeyBundleRequest) -> Result<(), String>;
}

pub struct PreKeyPublisher<R> {
    store: Arc<R>,
    endpoint: CryptoEndpoint,
}

impl<R: PreKeyRepository> PreKeyPublisher<R> {
    pub fn new(store: Arc<R>, endpoint: CryptoEndpoint) -> Result<Self, String> {
        endpoint.validate()?;
        Ok(Self { store, endpoint })
    }

    pub fn publish<T: PreKeyTransport>(
        &self,
        actor_identity: &IdentityKeyPair,
        now_unix_ms: i64,
        transport: &T,
    ) -> Result<(), String> {
        if !self.store.has_prekey_bundle()? {
            self.generate_fresh_bundle(now_unix_ms)?;
        }
        let Some(bundle) = self.store.pending_prekey_bundle()? else {
            return Ok(());
        };
        let request = upload_request(&self.endpoint, actor_identity, &bundle)?;
        transport.upload(&request)?;
        self.store
            .complete_prekey_publication(bundle.signed_prekey_id)
    }

    fn generate_fresh_bundle(&self, now_unix_ms: i64) -> Result<(), String> {
        if now_unix_ms <= 0 {
            return Err("messaging prekey generation time is invalid".to_string());
        }
        let signed_prekey = X25519KeyPair::generate();
        let signed_prekey_id = i32::try_from(
            now_unix_ms
                .div_euclid(1_000)
                .rem_euclid(i64::from(i32::MAX)),
        )
        .map_err(|_| "messaging signed prekey ID is invalid".to_string())?
        .max(1);
        let one_time_prekeys = (1..=INITIAL_ONE_TIME_PREKEY_COUNT)
            .map(|id| (id, X25519KeyPair::generate().private_bytes()))
            .collect::<Vec<_>>();
        self.store.install_fresh_prekey_bundle(
            signed_prekey_id,
            &signed_prekey.private_bytes(),
            &one_time_prekeys,
            now_unix_ms,
        )
    }
}

fn upload_request(
    endpoint: &CryptoEndpoint,
    actor_identity: &IdentityKeyPair,
    bundle: &PendingPreKeyBundle,
) -> Result<UploadDirectKeyBundleRequest, String> {
    let signed_prekey = X25519KeyPair::from_private_bytes(bundle.signed_prekey_private);
    let signed_prekey_public = signed_prekey.public_bytes();
    let signature = actor_identity.signing_key().sign(&signed_prekey_public);
    Ok(UploadDirectKeyBundleRequest {
        device: Some(actor_device_ref(&endpoint.ptid, &endpoint.device_id)),
        identity_key_public: B64.encode(actor_identity.verifying_key().to_bytes()),
        signed_pre_key_id: bundle.signed_prekey_id,
        signed_pre_key_public: B64.encode(signed_prekey_public),
        signed_pre_key_signature: B64.encode(signature.to_bytes()),
        one_time_pre_keys: bundle
            .one_time_prekeys
            .iter()
            .map(|(key_id, private_key)| DirectOneTimePreKey {
                key_id: *key_id,
                public_key: B64
                    .encode(X25519KeyPair::from_private_bytes(*private_key).public_bytes()),
            })
            .collect(),
        supported_wire_versions: vec![1],
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct RepositoryState {
        active: bool,
        bundle: Option<PendingPreKeyBundle>,
        published: bool,
    }

    #[derive(Default)]
    struct TestRepository {
        state: Mutex<RepositoryState>,
    }

    impl TestRepository {
        fn active() -> Self {
            Self {
                state: Mutex::new(RepositoryState {
                    active: true,
                    ..RepositoryState::default()
                }),
            }
        }
    }

    impl PreKeyRepository for TestRepository {
        fn has_prekey_bundle(&self) -> Result<bool, String> {
            Ok(self.state.lock().unwrap().bundle.is_some())
        }

        fn install_fresh_prekey_bundle(
            &self,
            signed_prekey_id: i32,
            signed_prekey_private: &[u8; 32],
            one_time_prekeys: &[(i32, [u8; 32])],
            _created_at_unix_ms: i64,
        ) -> Result<(), String> {
            let mut state = self.state.lock().unwrap();
            if !state.active {
                return Err("messaging prekeys require active device enrollment".to_string());
            }
            state.bundle = Some(PendingPreKeyBundle {
                signed_prekey_id,
                signed_prekey_private: *signed_prekey_private,
                one_time_prekeys: one_time_prekeys.to_vec(),
            });
            Ok(())
        }

        fn pending_prekey_bundle(&self) -> Result<Option<PendingPreKeyBundle>, String> {
            let state = self.state.lock().unwrap();
            Ok((!state.published).then(|| state.bundle.clone()).flatten())
        }

        fn complete_prekey_publication(&self, signed_prekey_id: i32) -> Result<(), String> {
            let mut state = self.state.lock().unwrap();
            if state.bundle.as_ref().map(|bundle| bundle.signed_prekey_id) != Some(signed_prekey_id)
            {
                return Err("messaging prekey publication transition was not applied".to_string());
            }
            state.published = true;
            Ok(())
        }
    }

    #[derive(Default)]
    struct RecordingTransport {
        requests: Mutex<Vec<UploadDirectKeyBundleRequest>>,
        fail_first: Mutex<bool>,
    }

    impl PreKeyTransport for RecordingTransport {
        fn upload(&self, request: &UploadDirectKeyBundleRequest) -> Result<(), String> {
            self.requests.lock().unwrap().push(request.clone());
            let mut fail = self.fail_first.lock().unwrap();
            if *fail {
                *fail = false;
                return Err("network".to_string());
            }
            Ok(())
        }
    }

    fn endpoint() -> CryptoEndpoint {
        CryptoEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "device-1".to_string(),
        }
    }

    #[test]
    fn retry_reuses_the_exact_prekey_publication() {
        let store = Arc::new(TestRepository::active());
        let publisher = PreKeyPublisher::new(store, endpoint()).unwrap();
        let transport = RecordingTransport {
            requests: Mutex::new(Vec::new()),
            fail_first: Mutex::new(true),
        };
        let identity = IdentityKeyPair::from_seed(&[7; 32]);

        assert!(publisher.publish(&identity, 10_000, &transport).is_err());
        publisher.publish(&identity, 20_000, &transport).unwrap();

        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0], requests[1]);
        assert_eq!(
            requests[0]
                .device
                .as_ref()
                .map(|device| device.device_id.as_str()),
            Some("device-1")
        );
        assert_eq!(
            requests[0].one_time_pre_keys.len(),
            INITIAL_ONE_TIME_PREKEY_COUNT as usize
        );
    }

    #[test]
    fn publication_requires_active_device_enrollment() {
        let publisher =
            PreKeyPublisher::new(Arc::new(TestRepository::default()), endpoint()).unwrap();
        assert!(publisher
            .publish(
                &IdentityKeyPair::from_seed(&[8; 32]),
                10_000,
                &RecordingTransport::default(),
            )
            .is_err());
    }
}
