use super::group::MlsGroupManager;
use crate::contracts::CryptoEndpoint;
use crate::proto::actor_device_ref_from_parts;
use crate::proto::key_exchange::UploadMlsKeyPackageRequest;
use crate::store::MlsKeyPackageRepository;
use std::sync::Arc;

const INITIAL_MLS_KEY_PACKAGE_COUNT: usize = 5;

pub trait MlsKeyPackageTransport: Send + Sync {
    fn upload(&self, request: &UploadMlsKeyPackageRequest) -> Result<(), String>;
}

pub struct MlsKeyPackagePublisher<R> {
    store: Arc<R>,
    manager: Arc<MlsGroupManager>,
    endpoint: CryptoEndpoint,
}

impl<R: MlsKeyPackageRepository> MlsKeyPackagePublisher<R> {
    pub fn new(
        store: Arc<R>,
        manager: Arc<MlsGroupManager>,
        endpoint: CryptoEndpoint,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging MLS KeyPackage publisher requires endpoint".to_string());
        }
        Ok(Self {
            store,
            manager,
            endpoint,
        })
    }

    pub fn publish<T: MlsKeyPackageTransport>(
        &self,
        now_unix_ms: i64,
        transport: &T,
    ) -> Result<(), String> {
        if !self.store.has_mls_key_packages()? {
            self.generate_fresh_batch(now_unix_ms)?;
        }
        for package in self.store.pending_mls_key_packages()? {
            transport.upload(&UploadMlsKeyPackageRequest {
                device: Some(actor_device_ref_from_parts(
                    &self.endpoint.ptid,
                    &self.endpoint.device_id,
                )),
                key_package: package.data,
            })?;
            self.store
                .complete_mls_key_package_publication(&package.package_id)?;
        }
        Ok(())
    }

    fn generate_fresh_batch(&self, now_unix_ms: i64) -> Result<(), String> {
        if now_unix_ms <= 0 {
            return Err("messaging MLS KeyPackage generation time is invalid".to_string());
        }
        let previous_pool = self.manager.export_pending_join_providers()?;
        let packages = (0..INITIAL_MLS_KEY_PACKAGE_COUNT)
            .map(|_| self.manager.generate_key_package())
            .collect::<Result<Vec<_>, _>>()?;
        let provider_pool = self.manager.export_pending_join_providers()?;
        if let Err(error) =
            self.store
                .install_fresh_mls_key_packages(&packages, &provider_pool, now_unix_ms)
        {
            self.manager
                .import_pending_join_providers(&previous_pool)
                .map_err(|rollback| {
                    format!(
                        "messaging MLS KeyPackage persistence failed: {error}; provider rollback failed: {rollback}"
                    )
                })?;
            return Err(error);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::PendingMlsKeyPackage;
    use crate::crypto::identity::IdentityKeyPair;
    use crate::identity::generate_fresh_device_identity;
    use sha2::{Digest, Sha256};
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingTransport {
        requests: Mutex<Vec<UploadMlsKeyPackageRequest>>,
        fail_first: Mutex<bool>,
    }

    impl MlsKeyPackageTransport for RecordingTransport {
        fn upload(&self, request: &UploadMlsKeyPackageRequest) -> Result<(), String> {
            self.requests.lock().unwrap().push(request.clone());
            let mut fail = self.fail_first.lock().unwrap();
            if *fail {
                *fail = false;
                return Err("network".to_string());
            }
            Ok(())
        }
    }

    struct StoredKeyPackage {
        package: PendingMlsKeyPackage,
        published: bool,
    }

    struct TestRepositoryState {
        active_enrollment: bool,
        fail_install: bool,
        provider_pool: Option<Vec<u8>>,
        packages: Vec<StoredKeyPackage>,
    }

    struct TestKeyPackageRepository {
        state: Mutex<TestRepositoryState>,
    }

    impl TestKeyPackageRepository {
        fn new(active_enrollment: bool) -> Self {
            Self {
                state: Mutex::new(TestRepositoryState {
                    active_enrollment,
                    fail_install: false,
                    provider_pool: None,
                    packages: Vec::new(),
                }),
            }
        }

        fn fail_install(&self) {
            self.state.lock().unwrap().fail_install = true;
        }

        fn provider_pool(&self) -> Option<Vec<u8>> {
            self.state.lock().unwrap().provider_pool.clone()
        }
    }

    impl MlsKeyPackageRepository for TestKeyPackageRepository {
        fn has_mls_key_packages(&self) -> Result<bool, String> {
            Ok(!self.state.lock().unwrap().packages.is_empty())
        }

        fn install_fresh_mls_key_packages(
            &self,
            packages: &[Vec<u8>],
            provider_pool_state: &[u8],
            _created_at_unix_ms: i64,
        ) -> Result<(), String> {
            let mut state = self.state.lock().unwrap();
            if !state.active_enrollment {
                return Err(
                    "messaging MLS KeyPackages require active device enrollment".to_string()
                );
            }
            if state.fail_install {
                return Err("persistence".to_string());
            }
            state.provider_pool = Some(provider_pool_state.to_vec());
            state.packages = packages
                .iter()
                .map(|data| StoredKeyPackage {
                    package: PendingMlsKeyPackage {
                        package_id: hex::encode(Sha256::digest(data)),
                        data: data.clone(),
                    },
                    published: false,
                })
                .collect();
            Ok(())
        }

        fn pending_mls_key_packages(&self) -> Result<Vec<PendingMlsKeyPackage>, String> {
            let mut packages = self
                .state
                .lock()
                .unwrap()
                .packages
                .iter()
                .filter(|stored| !stored.published)
                .map(|stored| stored.package.clone())
                .collect::<Vec<_>>();
            packages.sort_by(|left, right| left.package_id.cmp(&right.package_id));
            Ok(packages)
        }

        fn complete_mls_key_package_publication(&self, package_id: &str) -> Result<(), String> {
            let mut state = self.state.lock().unwrap();
            let package = state
                .packages
                .iter_mut()
                .find(|stored| stored.package.package_id == package_id && !stored.published)
                .ok_or_else(|| {
                    "messaging MLS KeyPackage publication was not applied".to_string()
                })?;
            package.published = true;
            Ok(())
        }
    }

    fn publisher(
        store: Arc<TestKeyPackageRepository>,
        seed: [u8; 32],
    ) -> (
        MlsKeyPackagePublisher<TestKeyPackageRepository>,
        Arc<MlsGroupManager>,
    ) {
        let identity = IdentityKeyPair::from_seed(&seed);
        let fresh = generate_fresh_device_identity("ptid:alice", identity.seed_bytes(), 1).unwrap();
        let device_id = fresh
            .enrollment
            .certificate
            .device
            .as_ref()
            .unwrap()
            .device_id
            .clone();
        let manager = Arc::new(MlsGroupManager::new());
        manager
            .actor_identity()
            .init("ptid:alice", &device_id)
            .unwrap();
        let publisher = MlsKeyPackagePublisher::new(
            store,
            manager.clone(),
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id,
            },
        )
        .unwrap();
        (publisher, manager)
    }

    #[test]
    fn mls_keypackage_retry_reuses_bytes_and_provider_pool_survives_restart() {
        let store = Arc::new(TestKeyPackageRepository::new(true));
        let (publisher, _) = publisher(store.clone(), [9; 32]);
        let transport = RecordingTransport {
            requests: Mutex::new(Vec::new()),
            fail_first: Mutex::new(true),
        };

        assert!(publisher.publish(10_000, &transport).is_err());
        assert_eq!(store.pending_mls_key_packages().unwrap().len(), 5);
        publisher.publish(20_000, &transport).unwrap();
        assert!(store.pending_mls_key_packages().unwrap().is_empty());
        assert!(store.provider_pool().is_some_and(|state| !state.is_empty()));
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 6);
        assert_eq!(requests[0], requests[1]);
    }

    #[test]
    fn mls_keypackages_cannot_be_generated_before_active_enrollment() {
        let store = Arc::new(TestKeyPackageRepository::new(false));
        let (publisher, _) = publisher(store, [10; 32]);

        assert!(publisher
            .publish(10_000, &RecordingTransport::default())
            .is_err());
    }

    #[test]
    fn mls_keypackage_persistence_failure_rolls_back_provider_pool() {
        let store = Arc::new(TestKeyPackageRepository::new(true));
        store.fail_install();
        let (publisher, manager) = publisher(store, [11; 32]);
        let previous_pool = manager.export_pending_join_providers().unwrap();

        assert!(publisher
            .publish(10_000, &RecordingTransport::default())
            .is_err());
        assert_eq!(
            manager.export_pending_join_providers().unwrap(),
            previous_pool
        );
    }
}
