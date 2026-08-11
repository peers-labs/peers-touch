use super::{EngineEndpoint, MessagingStore, PendingPreKeyBundle};
use crate::domain::crypto::{IdentityKeyPair, X25519KeyPair};
use crate::infrastructure::station_client;
use crate::model::key_exchange::{UploadKeyBundleRequest, UploadKeyBundleResponse};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::Signer;
use reqwest::Method;
use std::sync::Arc;

const INITIAL_ONE_TIME_PREKEY_COUNT: i32 = 20;

pub trait PreKeyTransport: Send + Sync {
    fn upload(&self, request: &UploadKeyBundleRequest) -> Result<(), String>;
}

pub struct StationPreKeyTransport {
    token: String,
    device_id: String,
}

impl StationPreKeyTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() || device_id.trim().is_empty() {
            return Err("messaging prekey transport requires token and device ID".to_string());
        }
        Ok(Self { token, device_id })
    }
}

impl PreKeyTransport for StationPreKeyTransport {
    fn upload(&self, request: &UploadKeyBundleRequest) -> Result<(), String> {
        if request.device_id != self.device_id {
            return Err("messaging prekey upload endpoint mismatch".to_string());
        }
        station_client::request_proto_for_device::<UploadKeyBundleRequest, UploadKeyBundleResponse>(
            Method::POST,
            "/key-exchange/keys/bundle",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}

pub struct PreKeyPublisher {
    store: Arc<MessagingStore>,
    endpoint: EngineEndpoint,
}

impl PreKeyPublisher {
    pub fn new(store: Arc<MessagingStore>, endpoint: EngineEndpoint) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging prekey publisher requires complete endpoint".to_string());
        }
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
    endpoint: &EngineEndpoint,
    actor_identity: &IdentityKeyPair,
    bundle: &PendingPreKeyBundle,
) -> Result<UploadKeyBundleRequest, String> {
    let signed_prekey = X25519KeyPair::from_private_bytes(bundle.signed_prekey_private);
    let signed_prekey_public = signed_prekey.public_bytes();
    let signature = actor_identity.signing_key().sign(&signed_prekey_public);
    let mut opk_ids = Vec::with_capacity(bundle.one_time_prekeys.len());
    let mut opk_pubs = Vec::with_capacity(bundle.one_time_prekeys.len());
    for (id, private_key) in &bundle.one_time_prekeys {
        opk_ids.push(*id);
        opk_pubs.push(B64.encode(X25519KeyPair::from_private_bytes(*private_key).public_bytes()));
    }
    Ok(UploadKeyBundleRequest {
        ik_pub: B64.encode(actor_identity.verifying_key().to_bytes()),
        spk_id: bundle.signed_prekey_id,
        spk_pub: B64.encode(signed_prekey_public),
        spk_sig: B64.encode(signature.to_bytes()),
        opk_ids,
        opk_pubs,
        device_id: endpoint.device_id.clone(),
        supported_versions: vec![1],
    })
}

#[cfg(test)]
mod tests {
    use super::super::identity::generate_fresh_device_identity;
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingTransport {
        requests: Mutex<Vec<UploadKeyBundleRequest>>,
        fail_first: Mutex<bool>,
    }

    impl PreKeyTransport for RecordingTransport {
        fn upload(&self, request: &UploadKeyBundleRequest) -> Result<(), String> {
            self.requests.lock().unwrap().push(request.clone());
            let mut fail = self.fail_first.lock().unwrap();
            if *fail {
                *fail = false;
                return Err("network".to_string());
            }
            Ok(())
        }
    }

    #[test]
    fn prekey_retry_reuses_identical_bundle_and_opk_is_single_use() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let identity = IdentityKeyPair::from_seed(&[7; 32]);
        let fresh = generate_fresh_device_identity("ptid:alice", identity.seed_bytes(), 1).unwrap();
        store.install_fresh_device_identity(&fresh).unwrap();
        store
            .complete_device_enrollment(&fresh.enrollment.certificate.device_id)
            .unwrap();
        let publisher = PreKeyPublisher::new(
            store.clone(),
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: fresh.enrollment.certificate.device_id,
            },
        )
        .unwrap();
        let transport = RecordingTransport {
            requests: Mutex::new(Vec::new()),
            fail_first: Mutex::new(true),
        };
        assert!(publisher.publish(&identity, 10_000, &transport).is_err());
        assert!(store.pending_prekey_bundle().unwrap().is_some());
        publisher.publish(&identity, 20_000, &transport).unwrap();

        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0], requests[1]);
        let signed_prekey_id = requests[0].spk_id;
        let opk_id = requests[0].opk_ids[0];
        drop(requests);
        assert!(store.load_signed_prekey(signed_prekey_id).is_ok());
        assert!(store.consume_one_time_prekey(opk_id).is_ok());
        assert!(store.consume_one_time_prekey(opk_id).is_err());
        assert!(store.pending_prekey_bundle().unwrap().is_none());
    }

    #[test]
    fn prekeys_cannot_be_created_before_device_enrollment_is_active() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let identity = IdentityKeyPair::from_seed(&[8; 32]);
        let fresh = generate_fresh_device_identity("ptid:alice", identity.seed_bytes(), 1).unwrap();
        store.install_fresh_device_identity(&fresh).unwrap();
        let publisher = PreKeyPublisher::new(
            store,
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: fresh.enrollment.certificate.device_id,
            },
        )
        .unwrap();
        assert!(publisher
            .publish(&identity, 10_000, &RecordingTransport::default())
            .is_err());
    }
}
