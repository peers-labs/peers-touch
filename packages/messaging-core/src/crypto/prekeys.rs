use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ed25519_dalek::Signer;

use super::identity::{IdentityKeyPair, X25519KeyPair};
use crate::contracts::CryptoEndpoint;
use crate::proto::actor_device_ref;
use crate::proto::key_exchange::{
    CountDirectOneTimePreKeysRequest, DirectOneTimePreKey, ReplenishDirectOneTimePreKeysRequest,
    UploadDirectKeyBundleRequest,
};

const INITIAL_ONE_TIME_PREKEY_COUNT: i32 = 20;
const REPLENISH_ONE_TIME_PREKEY_COUNT: i32 = 20;

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

pub trait PreKeyInventoryRepository: Send + Sync {
    fn next_one_time_prekey_id(&self) -> Result<i32, String>;

    fn install_prekey_replenishment(
        &self,
        one_time_prekeys: &[(i32, [u8; 32])],
    ) -> Result<(), String>;

    fn pending_prekey_replenishment(&self) -> Result<Option<PendingPreKeyBundle>, String>;

    fn complete_prekey_replenishment(&self, one_time_prekey_ids: &[i32]) -> Result<(), String>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemotePreKeyInventory {
    MissingBundle,
    Available(i64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreKeyReplenishOutcome {
    Applied,
    MissingBundle,
}

pub trait PreKeyInventoryTransport: Send + Sync {
    fn inventory(
        &self,
        request: &CountDirectOneTimePreKeysRequest,
    ) -> Result<RemotePreKeyInventory, String>;

    fn replenish(
        &self,
        request: &ReplenishDirectOneTimePreKeysRequest,
    ) -> Result<PreKeyReplenishOutcome, String>;
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

    pub fn reconcile<T>(
        &self,
        actor_identity: &IdentityKeyPair,
        transport: &T,
    ) -> Result<(), String>
    where
        R: PreKeyInventoryRepository,
        T: PreKeyTransport + PreKeyInventoryTransport,
    {
        if let Some(bundle) = self.store.pending_prekey_replenishment()? {
            return self.publish_replenishment(actor_identity, &bundle, false, transport);
        }

        let inventory = transport.inventory(&CountDirectOneTimePreKeysRequest {
            device: Some(actor_device_ref(
                &self.endpoint.ptid,
                &self.endpoint.device_id,
            )),
        })?;
        match inventory {
            RemotePreKeyInventory::Available(count) if count > 0 => return Ok(()),
            RemotePreKeyInventory::Available(count) if count < 0 => {
                return Err("messaging remote prekey inventory is invalid".to_string());
            }
            RemotePreKeyInventory::Available(_) | RemotePreKeyInventory::MissingBundle => {}
        }

        self.generate_replenishment()?;
        let bundle = self
            .store
            .pending_prekey_replenishment()?
            .ok_or_else(|| "messaging prekey replenishment was not persisted".to_string())?;
        self.publish_replenishment(
            actor_identity,
            &bundle,
            inventory == RemotePreKeyInventory::MissingBundle,
            transport,
        )
    }

    fn generate_replenishment(&self) -> Result<(), String>
    where
        R: PreKeyInventoryRepository,
    {
        let first_id = self.store.next_one_time_prekey_id()?;
        let one_time_prekeys = (0..REPLENISH_ONE_TIME_PREKEY_COUNT)
            .map(|offset| {
                first_id
                    .checked_add(offset)
                    .filter(|id| *id > 0)
                    .map(|id| (id, X25519KeyPair::generate().private_bytes()))
                    .ok_or_else(|| "messaging one-time prekey ID space is exhausted".to_string())
            })
            .collect::<Result<Vec<_>, String>>()?;
        self.store.install_prekey_replenishment(&one_time_prekeys)
    }

    fn publish_replenishment<T>(
        &self,
        actor_identity: &IdentityKeyPair,
        bundle: &PendingPreKeyBundle,
        bundle_missing: bool,
        transport: &T,
    ) -> Result<(), String>
    where
        R: PreKeyInventoryRepository,
        T: PreKeyTransport + PreKeyInventoryTransport,
    {
        let replenish_request = replenish_request(&self.endpoint, bundle);
        let upload_required = if bundle_missing {
            true
        } else {
            transport.replenish(&replenish_request)? == PreKeyReplenishOutcome::MissingBundle
        };
        if upload_required {
            transport.upload(&upload_request(&self.endpoint, actor_identity, bundle)?)?;
        }
        self.store.complete_prekey_replenishment(
            &bundle
                .one_time_prekeys
                .iter()
                .map(|(id, _)| *id)
                .collect::<Vec<_>>(),
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

fn replenish_request(
    endpoint: &CryptoEndpoint,
    bundle: &PendingPreKeyBundle,
) -> ReplenishDirectOneTimePreKeysRequest {
    ReplenishDirectOneTimePreKeysRequest {
        device: Some(actor_device_ref(&endpoint.ptid, &endpoint.device_id)),
        one_time_pre_keys: bundle
            .one_time_prekeys
            .iter()
            .map(|(key_id, private_key)| DirectOneTimePreKey {
                key_id: *key_id,
                public_key: B64
                    .encode(X25519KeyPair::from_private_bytes(*private_key).public_bytes()),
            })
            .collect(),
    }
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
        replenishment: Option<PendingPreKeyBundle>,
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

    impl PreKeyInventoryRepository for TestRepository {
        fn next_one_time_prekey_id(&self) -> Result<i32, String> {
            let state = self.state.lock().unwrap();
            state
                .bundle
                .iter()
                .flat_map(|bundle| bundle.one_time_prekeys.iter())
                .chain(
                    state
                        .replenishment
                        .iter()
                        .flat_map(|bundle| bundle.one_time_prekeys.iter()),
                )
                .map(|(id, _)| *id)
                .max()
                .unwrap_or_default()
                .checked_add(1)
                .ok_or_else(|| "messaging one-time prekey ID space is exhausted".to_string())
        }

        fn install_prekey_replenishment(
            &self,
            one_time_prekeys: &[(i32, [u8; 32])],
        ) -> Result<(), String> {
            let mut state = self.state.lock().unwrap();
            let bundle = state
                .bundle
                .as_ref()
                .filter(|_| state.published)
                .ok_or_else(|| "messaging published prekey bundle is unavailable".to_string())?;
            state.replenishment = Some(PendingPreKeyBundle {
                signed_prekey_id: bundle.signed_prekey_id,
                signed_prekey_private: bundle.signed_prekey_private,
                one_time_prekeys: one_time_prekeys.to_vec(),
            });
            Ok(())
        }

        fn pending_prekey_replenishment(&self) -> Result<Option<PendingPreKeyBundle>, String> {
            Ok(self.state.lock().unwrap().replenishment.clone())
        }

        fn complete_prekey_replenishment(&self, one_time_prekey_ids: &[i32]) -> Result<(), String> {
            let mut state = self.state.lock().unwrap();
            let replenishment = state
                .replenishment
                .take()
                .ok_or_else(|| "messaging prekey replenishment is unavailable".to_string())?;
            let persisted_ids = replenishment
                .one_time_prekeys
                .iter()
                .map(|(id, _)| *id)
                .collect::<Vec<_>>();
            if persisted_ids != one_time_prekey_ids {
                return Err("messaging prekey replenishment transition was not applied".to_string());
            }
            state
                .bundle
                .as_mut()
                .expect("published test bundle")
                .one_time_prekeys
                .extend(replenishment.one_time_prekeys);
            Ok(())
        }
    }

    struct RecordingTransport {
        requests: Mutex<Vec<UploadDirectKeyBundleRequest>>,
        fail_first: Mutex<bool>,
        inventory: Mutex<RemotePreKeyInventory>,
        replenishments: Mutex<Vec<ReplenishDirectOneTimePreKeysRequest>>,
        replenish_outcome: Mutex<PreKeyReplenishOutcome>,
        fail_replenish_once: Mutex<bool>,
    }

    impl Default for RecordingTransport {
        fn default() -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                fail_first: Mutex::new(false),
                inventory: Mutex::new(RemotePreKeyInventory::Available(1)),
                replenishments: Mutex::new(Vec::new()),
                replenish_outcome: Mutex::new(PreKeyReplenishOutcome::Applied),
                fail_replenish_once: Mutex::new(false),
            }
        }
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

    impl PreKeyInventoryTransport for RecordingTransport {
        fn inventory(
            &self,
            _request: &CountDirectOneTimePreKeysRequest,
        ) -> Result<RemotePreKeyInventory, String> {
            Ok(*self.inventory.lock().unwrap())
        }

        fn replenish(
            &self,
            request: &ReplenishDirectOneTimePreKeysRequest,
        ) -> Result<PreKeyReplenishOutcome, String> {
            self.replenishments.lock().unwrap().push(request.clone());
            let mut fail = self.fail_replenish_once.lock().unwrap();
            if *fail {
                *fail = false;
                return Err("network".to_string());
            }
            Ok(*self.replenish_outcome.lock().unwrap())
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
            fail_first: Mutex::new(true),
            ..RecordingTransport::default()
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

    #[test]
    fn reconciliation_rebuilds_missing_station_bundle_with_fresh_opks() {
        let store = Arc::new(TestRepository::active());
        let publisher = PreKeyPublisher::new(store.clone(), endpoint()).unwrap();
        let identity = IdentityKeyPair::from_seed(&[9; 32]);
        publisher
            .publish(&identity, 10_000, &RecordingTransport::default())
            .unwrap();
        let signed_prekey_id = store
            .state
            .lock()
            .unwrap()
            .bundle
            .as_ref()
            .unwrap()
            .signed_prekey_id;
        let transport = RecordingTransport {
            inventory: Mutex::new(RemotePreKeyInventory::MissingBundle),
            ..RecordingTransport::default()
        };

        publisher.reconcile(&identity, &transport).unwrap();

        assert!(transport.replenishments.lock().unwrap().is_empty());
        let uploads = transport.requests.lock().unwrap();
        assert_eq!(uploads.len(), 1);
        assert_eq!(uploads[0].signed_pre_key_id, signed_prekey_id);
        assert_eq!(
            uploads[0]
                .one_time_pre_keys
                .iter()
                .map(|key| key.key_id)
                .collect::<Vec<_>>(),
            (21..=40).collect::<Vec<_>>()
        );
        assert!(store.state.lock().unwrap().replenishment.is_none());
    }

    #[test]
    fn reconciliation_uses_replenish_for_an_empty_remote_inventory() {
        let store = Arc::new(TestRepository::active());
        let publisher = PreKeyPublisher::new(store.clone(), endpoint()).unwrap();
        let identity = IdentityKeyPair::from_seed(&[10; 32]);
        publisher
            .publish(&identity, 10_000, &RecordingTransport::default())
            .unwrap();
        let transport = RecordingTransport {
            inventory: Mutex::new(RemotePreKeyInventory::Available(0)),
            ..RecordingTransport::default()
        };

        publisher.reconcile(&identity, &transport).unwrap();

        assert!(transport.requests.lock().unwrap().is_empty());
        let replenishments = transport.replenishments.lock().unwrap();
        assert_eq!(replenishments.len(), 1);
        assert_eq!(
            replenishments[0]
                .one_time_pre_keys
                .iter()
                .map(|key| key.key_id)
                .collect::<Vec<_>>(),
            (21..=40).collect::<Vec<_>>()
        );
    }

    #[test]
    fn reconciliation_retry_reuses_the_exact_replenishment() {
        let store = Arc::new(TestRepository::active());
        let publisher = PreKeyPublisher::new(store.clone(), endpoint()).unwrap();
        let identity = IdentityKeyPair::from_seed(&[11; 32]);
        publisher
            .publish(&identity, 10_000, &RecordingTransport::default())
            .unwrap();
        let transport = RecordingTransport {
            inventory: Mutex::new(RemotePreKeyInventory::Available(0)),
            fail_replenish_once: Mutex::new(true),
            ..RecordingTransport::default()
        };

        assert!(publisher.reconcile(&identity, &transport).is_err());
        publisher.reconcile(&identity, &transport).unwrap();

        let replenishments = transport.replenishments.lock().unwrap();
        assert_eq!(replenishments.len(), 2);
        assert_eq!(replenishments[0], replenishments[1]);
        assert!(store.state.lock().unwrap().replenishment.is_none());
    }

    #[test]
    fn missing_bundle_retry_after_lost_upload_ack_reuses_the_fresh_opk_batch() {
        let store = Arc::new(TestRepository::active());
        let publisher = PreKeyPublisher::new(store.clone(), endpoint()).unwrap();
        let identity = IdentityKeyPair::from_seed(&[14; 32]);
        publisher
            .publish(&identity, 10_000, &RecordingTransport::default())
            .unwrap();
        let transport = RecordingTransport {
            fail_first: Mutex::new(true),
            inventory: Mutex::new(RemotePreKeyInventory::MissingBundle),
            ..RecordingTransport::default()
        };

        assert!(publisher.reconcile(&identity, &transport).is_err());
        publisher.reconcile(&identity, &transport).unwrap();

        let uploads = transport.requests.lock().unwrap();
        let replenishments = transport.replenishments.lock().unwrap();
        assert_eq!(uploads.len(), 1);
        assert_eq!(replenishments.len(), 1);
        assert_eq!(
            uploads[0].one_time_pre_keys,
            replenishments[0].one_time_pre_keys
        );
        assert_eq!(
            uploads[0]
                .one_time_pre_keys
                .iter()
                .map(|key| key.key_id)
                .collect::<Vec<_>>(),
            (21..=40).collect::<Vec<_>>()
        );
        assert!(store.state.lock().unwrap().replenishment.is_none());
    }

    #[test]
    fn missing_bundle_retry_reuploads_identical_bytes_when_upload_did_not_commit() {
        let store = Arc::new(TestRepository::active());
        let publisher = PreKeyPublisher::new(store.clone(), endpoint()).unwrap();
        let identity = IdentityKeyPair::from_seed(&[15; 32]);
        publisher
            .publish(&identity, 10_000, &RecordingTransport::default())
            .unwrap();
        let transport = RecordingTransport {
            fail_first: Mutex::new(true),
            inventory: Mutex::new(RemotePreKeyInventory::MissingBundle),
            replenish_outcome: Mutex::new(PreKeyReplenishOutcome::MissingBundle),
            ..RecordingTransport::default()
        };

        assert!(publisher.reconcile(&identity, &transport).is_err());
        publisher.reconcile(&identity, &transport).unwrap();

        let uploads = transport.requests.lock().unwrap();
        assert_eq!(uploads.len(), 2);
        assert_eq!(uploads[0], uploads[1]);
        assert_eq!(
            transport.replenishments.lock().unwrap()[0].one_time_pre_keys,
            uploads[0].one_time_pre_keys
        );
        assert!(store.state.lock().unwrap().replenishment.is_none());
    }

    #[test]
    fn reconciliation_falls_back_when_replenish_discovers_a_missing_bundle() {
        let store = Arc::new(TestRepository::active());
        let publisher = PreKeyPublisher::new(store, endpoint()).unwrap();
        let identity = IdentityKeyPair::from_seed(&[12; 32]);
        publisher
            .publish(&identity, 10_000, &RecordingTransport::default())
            .unwrap();
        let transport = RecordingTransport {
            inventory: Mutex::new(RemotePreKeyInventory::Available(0)),
            replenish_outcome: Mutex::new(PreKeyReplenishOutcome::MissingBundle),
            ..RecordingTransport::default()
        };

        publisher.reconcile(&identity, &transport).unwrap();

        let replenishments = transport.replenishments.lock().unwrap();
        let uploads = transport.requests.lock().unwrap();
        assert_eq!(replenishments.len(), 1);
        assert_eq!(uploads.len(), 1);
        assert_eq!(
            replenishments[0].one_time_pre_keys,
            uploads[0].one_time_pre_keys
        );
    }

    #[test]
    fn reconciliation_keeps_a_non_empty_remote_inventory_unchanged() {
        let store = Arc::new(TestRepository::active());
        let publisher = PreKeyPublisher::new(store.clone(), endpoint()).unwrap();
        let identity = IdentityKeyPair::from_seed(&[13; 32]);
        publisher
            .publish(&identity, 10_000, &RecordingTransport::default())
            .unwrap();
        let transport = RecordingTransport::default();

        publisher.reconcile(&identity, &transport).unwrap();

        assert!(transport.replenishments.lock().unwrap().is_empty());
        assert!(transport.requests.lock().unwrap().is_empty());
        assert!(store.state.lock().unwrap().replenishment.is_none());
    }
}
