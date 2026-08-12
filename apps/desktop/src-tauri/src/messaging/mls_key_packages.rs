use super::{EngineEndpoint, MessagingStore};
use crate::domain::mls_group::MlsGroupManager;
use crate::infrastructure::station_client;
use crate::model::chat::{UploadKeyPackageRequest, UploadKeyPackageResponse};
use reqwest::Method;
use std::sync::Arc;

const INITIAL_MLS_KEY_PACKAGE_COUNT: usize = 5;

pub trait MlsKeyPackageTransport: Send + Sync {
    fn upload(&self, request: &UploadKeyPackageRequest) -> Result<(), String>;
}

pub struct StationMlsKeyPackageTransport {
    token: String,
    device_id: String,
}

impl StationMlsKeyPackageTransport {
    pub fn new(token: String, device_id: String) -> Result<Self, String> {
        if token.trim().is_empty() || device_id.trim().is_empty() {
            return Err(
                "messaging MLS KeyPackage transport requires token and device ID".to_string(),
            );
        }
        Ok(Self { token, device_id })
    }
}

impl MlsKeyPackageTransport for StationMlsKeyPackageTransport {
    fn upload(&self, request: &UploadKeyPackageRequest) -> Result<(), String> {
        if request.device_id != self.device_id || request.data.is_empty() {
            return Err("messaging MLS KeyPackage endpoint binding mismatch".to_string());
        }
        station_client::request_proto_for_device::<
            UploadKeyPackageRequest,
            UploadKeyPackageResponse,
        >(
            Method::POST,
            "/keypackage/upload",
            &self.token,
            None,
            Some(request),
            &self.device_id,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
}

pub struct MlsKeyPackagePublisher {
    store: Arc<MessagingStore>,
    manager: Arc<MlsGroupManager>,
    endpoint: EngineEndpoint,
}

impl MlsKeyPackagePublisher {
    pub fn new(
        store: Arc<MessagingStore>,
        manager: Arc<MlsGroupManager>,
        endpoint: EngineEndpoint,
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
            transport.upload(&UploadKeyPackageRequest {
                device_id: self.endpoint.device_id.clone(),
                data: package.data,
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
    use super::super::identity::generate_fresh_device_identity;
    use super::*;
    use crate::domain::crypto::IdentityKeyPair;
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingTransport {
        requests: Mutex<Vec<UploadKeyPackageRequest>>,
        fail_first: Mutex<bool>,
    }

    impl MlsKeyPackageTransport for RecordingTransport {
        fn upload(&self, request: &UploadKeyPackageRequest) -> Result<(), String> {
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
    fn mls_keypackage_retry_reuses_bytes_and_provider_pool_survives_restart() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let identity = IdentityKeyPair::from_seed(&[9; 32]);
        let fresh = generate_fresh_device_identity("ptid:alice", identity.seed_bytes(), 1).unwrap();
        store.install_fresh_device_identity(&fresh).unwrap();
        store
            .complete_device_enrollment(&fresh.enrollment.certificate.device_id)
            .unwrap();
        let manager = Arc::new(MlsGroupManager::new());
        manager
            .actor_identity()
            .init("ptid:alice", &fresh.enrollment.certificate.device_id)
            .unwrap();
        let publisher = MlsKeyPackagePublisher::new(
            store.clone(),
            manager,
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
        assert!(publisher.publish(10_000, &transport).is_err());
        assert_eq!(store.pending_mls_key_packages().unwrap().len(), 5);
        publisher.publish(20_000, &transport).unwrap();
        assert!(store.pending_mls_key_packages().unwrap().is_empty());
        assert!(store
            .load_mls_join_provider_pool()
            .unwrap()
            .is_some_and(|state| !state.is_empty()));
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 6);
        assert_eq!(requests[0], requests[1]);
    }

    #[test]
    fn mls_keypackages_cannot_be_generated_before_active_enrollment() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let identity = IdentityKeyPair::from_seed(&[10; 32]);
        let fresh = generate_fresh_device_identity("ptid:alice", identity.seed_bytes(), 1).unwrap();
        store.install_fresh_device_identity(&fresh).unwrap();
        let manager = Arc::new(MlsGroupManager::new());
        manager
            .actor_identity()
            .init("ptid:alice", &fresh.enrollment.certificate.device_id)
            .unwrap();
        let publisher = MlsKeyPackagePublisher::new(
            store,
            manager,
            EngineEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: fresh.enrollment.certificate.device_id,
            },
        )
        .unwrap();
        assert!(publisher
            .publish(10_000, &RecordingTransport::default())
            .is_err());
    }
}
