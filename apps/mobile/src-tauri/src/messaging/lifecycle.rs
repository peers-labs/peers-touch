use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use messaging_core::attachment::AttachmentTransferControl;
use messaging_core::contracts::{ConversationProjection, CryptoEndpoint};
use messaging_core::crypto::prekeys::{PendingPreKeyBundle, PreKeyBundleBackup};
use messaging_core::engine::{
    activate_engine, advance_engine_consumer_epoch, begin_engine_stop, complete_engine_start,
    complete_engine_stop, recover_interrupted_engine, resume_engine, suspend_engine,
    validate_active_engine, validate_engine_fence, CommandReconciliationProgress, EngineFence,
    EngineLifecycleRecord, EnginePhase,
};
use messaging_core::identity::{
    generate_fresh_device_identity_for_device, DeviceEnrollmentRepository,
};
use messaging_core::inbox::DrainProgress;
use messaging_core::outbox::CommandDispatchProgress;
use messaging_core::ports::LifecycleCancellation;
use messaging_core::store::MessagingRepository;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime};
use zeroize::Zeroizing;

use crate::domain::crypto::identity_keys;
use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;

use super::engine::{
    validate_account_scope, DeviceSigningSeedBackup, MessageDraftResumeProgress,
    MobileMessagingEngine, SecureContentRuntimeIdentity,
};

const DATABASE_KEY_PREFIX: &str = "messaging.v1.sqlcipher";
const MAX_CONTINUATION_CYCLES: usize = 8;
const FAILURE_RETRY_DELAY: Duration = Duration::from_secs(1);
pub const MOBILE_MESSAGING_PROJECTION_EVENT: &str = "mobile:messaging-projection-changed";

const DEVICE_SEED_PREFIX: &str = "messaging.v1.device-signing-seed";

/// Backs the device signing seed into native secure storage, which (unlike the
/// wipeable app-data database) preserves the device identity across reinstalls.
struct StorageDeviceSeedBackup<'a> {
    storage: &'a SecureStorage,
    key: String,
}

impl<'a> StorageDeviceSeedBackup<'a> {
    fn new(
        storage: &'a SecureStorage,
        station_peer_id: &str,
        actor_ptid: &str,
        device_id: &str,
    ) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(station_peer_id.as_bytes());
        hasher.update([0x1f]);
        hasher.update(actor_ptid.as_bytes());
        hasher.update([0x1f]);
        hasher.update(device_id.as_bytes());
        let digest = hasher.finalize();
        let suffix: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
        Self {
            storage,
            key: format!("{DEVICE_SEED_PREFIX}.{suffix}"),
        }
    }
}

impl DeviceSigningSeedBackup for StorageDeviceSeedBackup<'_> {
    fn load(&self) -> Result<Option<[u8; 32]>, String> {
        let stored = self
            .storage
            .get(&self.key)
            .map_err(|e| format!("read device seed backup: {e}"))?;
        let Some(value) = stored else { return Ok(None) };
        let bytes = B64
            .decode(value.trim())
            .map_err(|e| format!("device seed backup is not base64: {e}"))?;
        if bytes.len() != 32 {
            return Err("device seed backup must be 32 bytes".to_string());
        }
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&bytes);
        Ok(Some(seed))
    }

    fn store(&self, seed: &[u8; 32]) -> Result<(), String> {
        self.storage
            .set(&self.key, &B64.encode(seed))
            .map_err(|e| format!("write device seed backup: {e}"))
    }
}

const PREKEY_BUNDLE_PREFIX: &str = "messaging.v1.prekey-bundle";

/// Backs the published Direct prekey bundle into native secure storage so a
/// reinstall can restore the identical signed prekey + one-time keys instead
/// of rotating them (the Station rejects a replay that rotates live ids).
struct StoragePreKeyBundleBackup {
    storage: SecureStorage,
    key: String,
}

impl StoragePreKeyBundleBackup {
    fn new(
        storage: SecureStorage,
        station_peer_id: &str,
        actor_ptid: &str,
        device_id: &str,
    ) -> Arc<Self> {
        let mut hasher = Sha256::new();
        hasher.update(station_peer_id.as_bytes());
        hasher.update([0x1f]);
        hasher.update(actor_ptid.as_bytes());
        hasher.update([0x1f]);
        hasher.update(device_id.as_bytes());
        let digest = hasher.finalize();
        let suffix: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
        Arc::new(Self {
            storage,
            key: format!("{PREKEY_BUNDLE_PREFIX}.{suffix}"),
        })
    }
}

impl PreKeyBundleBackup for StoragePreKeyBundleBackup {
    fn load_bundle(&self) -> Result<Option<PendingPreKeyBundle>, String> {
        let stored = self
            .storage
            .get(&self.key)
            .map_err(|e| format!("read prekey bundle backup: {e}"))?;
        let Some(value) = stored else { return Ok(None) };
        let bundle = serde_json::from_str(value.trim())
            .map_err(|e| format!("prekey bundle backup is invalid: {e}"))?;
        Ok(Some(bundle))
    }

    fn store_bundle(&self, bundle: &PendingPreKeyBundle) -> Result<(), String> {
        // Merge by prekey id so replenishment batches accumulate on the same
        // continuity record instead of re-rotating existing ids.
        let mut merged = match self.load_bundle()? {
            Some(existing) => existing,
            None => PendingPreKeyBundle {
                signed_prekey_id: bundle.signed_prekey_id,
                signed_prekey_private: bundle.signed_prekey_private,
                one_time_prekeys: Vec::new(),
            },
        };
        if bundle.signed_prekey_id >= merged.signed_prekey_id {
            merged.signed_prekey_id = bundle.signed_prekey_id;
            merged.signed_prekey_private = bundle.signed_prekey_private;
        }
        let mut by_id: BTreeMap<i32, [u8; 32]> = merged.one_time_prekeys.into_iter().collect();
        for (id, key) in &bundle.one_time_prekeys {
            by_id.insert(*id, *key);
        }
        merged.one_time_prekeys = by_id.into_iter().collect();

        let encoded = serde_json::to_string(&merged)
            .map_err(|e| format!("encode prekey bundle backup: {e}"))?;
        self.storage
            .set(&self.key, &encoded)
            .map_err(|e| format!("write prekey bundle backup: {e}"))
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessagingWorkerPhase {
    Running,
    Suspended,
    Stopping,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessagingProjectionEvent {
    pub station_peer_id: String,
    pub actor_ptid: String,
    pub profile_id: String,
    pub activation_generation: u64,
    pub cycle_id: u64,
    pub conversation_id: String,
    pub event_id: String,
    pub lane_sequence: i64,
}

type ProjectionEventSink =
    Arc<dyn Fn(MessagingProjectionEvent) -> Result<(), String> + Send + Sync>;

#[derive(Debug, Clone)]
pub struct MessagingWorkerCycleResult {
    pub device_enrolled: bool,
    pub drain: DrainProgress,
    pub delivery_receipt_submitted: bool,
    pub reconciliation: CommandReconciliationProgress,
    pub command: CommandDispatchProgress,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessagingRuntimeStatus {
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station_peer_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station_origin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_ptid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    pub device_enrolled: bool,
    pub lane_sequence: i64,
    pub consumer_epoch: u64,
    pub conversation_count: usize,
    pub activation_generation: u64,
    pub worker_phase: MessagingWorkerPhase,
}

impl MessagingRuntimeStatus {
    pub(crate) fn inactive() -> Self {
        Self {
            active: false,
            profile_id: None,
            station_peer_id: None,
            station_origin: None,
            actor_ptid: None,
            device_id: None,
            device_enrolled: false,
            lane_sequence: 0,
            consumer_epoch: 0,
            conversation_count: 0,
            activation_generation: 0,
            worker_phase: MessagingWorkerPhase::Suspended,
        }
    }
}

struct ActiveMessagingRuntime {
    engine: Arc<MobileMessagingEngine>,
    worker: MobileMessagingWorker,
}

#[derive(Default)]
pub struct MobileMessagingRuntime {
    active: Mutex<Option<ActiveMessagingRuntime>>,
    last_lifecycle: Mutex<Option<EngineLifecycleRecord>>,
}

impl MobileMessagingRuntime {
    pub fn activate<R: Runtime>(
        &self,
        app: AppHandle<R>,
        data_root: &Path,
        storage: &SecureStorage,
        station_peer_id: String,
        station_origin: String,
        actor_ptid: String,
        device_id: String,
        actor_profile_version: u64,
        access_token: String,
    ) -> MobileResult<MessagingRuntimeStatus> {
        let station_peer_id = station_peer_id.trim().to_string();
        let station_origin = station_origin.trim_end_matches('/').to_string();
        let actor_ptid = actor_ptid.trim().to_string();
        let device_id = device_id.trim().to_string();
        validate_account_scope(&station_peer_id, &station_origin, &actor_ptid)
            .map_err(MobileError::messaging)?;
        if actor_profile_version == 0 {
            return Err(MobileError::messaging(
                "mobile messaging actor profile revision is unavailable",
            ));
        }
        let user_scope = format!("{station_peer_id}|{actor_ptid}");
        let actor_identity = identity_keys::ensure_identity(storage, &user_scope, &actor_ptid)?;
        let actor_identity_seed = actor_identity.signing_key.to_bytes();
        let profile_id = profile_id(&station_peer_id, &actor_ptid);
        let database_key = load_or_create_database_key(storage, &profile_id)?;
        let database_path = database_path(data_root, &profile_id)?;
        let projection_app = app.clone();
        let event_sink: ProjectionEventSink = Arc::new(move |event| {
            projection_app
                .emit(MOBILE_MESSAGING_PROJECTION_EVENT, event)
                .map_err(|error| format!("emit mobile messaging projection event: {error}"))
        });
        let wake_station_peer_id = station_peer_id.clone();
        let wake_actor_ptid = actor_ptid.clone();
        let seed_backup =
            StorageDeviceSeedBackup::new(storage, &station_peer_id, &actor_ptid, &device_id);
        let prekey_backup: Arc<dyn PreKeyBundleBackup> = StoragePreKeyBundleBackup::new(
            storage.clone(),
            &station_peer_id,
            &actor_ptid,
            &device_id,
        );
        let status = self
            .activate_with_material(
                &database_path,
                profile_id,
                station_peer_id,
                station_origin,
                actor_ptid,
                device_id,
                &database_key,
                actor_identity_seed,
                actor_profile_version,
                access_token,
                event_sink,
                &seed_backup,
                prekey_backup,
            )
            .map_err(MobileError::messaging)?;
        self.wake(&wake_station_peer_id, &wake_actor_ptid)?;
        Ok(status)
    }

    fn activate_with_material(
        &self,
        database_path: &Path,
        profile_id: String,
        station_peer_id: String,
        station_origin: String,
        actor_ptid: String,
        device_id: String,
        database_key: &[u8; 32],
        actor_identity_seed: [u8; 32],
        actor_profile_version: u64,
        access_token: String,
        event_sink: ProjectionEventSink,
        seed_backup: &dyn DeviceSigningSeedBackup,
        prekey_backup: Arc<dyn PreKeyBundleBackup>,
    ) -> Result<MessagingRuntimeStatus, String> {
        validate_account_scope(&station_peer_id, &station_origin, &actor_ptid)?;
        let mut active = self
            .active
            .lock()
            .map_err(|_| "mobile messaging runtime lock poisoned".to_string())?;
        if let Some(runtime) = active.as_ref() {
            if runtime.engine.profile_id() != profile_id
                || runtime.engine.scope().station_peer_id != station_peer_id
                || runtime.engine.scope().actor_ptid != actor_ptid
                || runtime.engine.scope().device_id != device_id
            {
                return Err(
                    "mobile messaging runtime is already bound to another account".to_string(),
                );
            }
            if runtime.engine.scope().station_origin == station_origin
                && runtime.worker.is_active()?
            {
                runtime.engine.refresh_access_token(access_token)?;
                if runtime.worker.phase()? == MessagingWorkerPhase::Suspended {
                    runtime.worker.resume()?;
                }
                return status_for_active(runtime);
            }
        }
        let previous_lifecycle =
            if let Some(ActiveMessagingRuntime { engine, worker }) = active.take() {
                let lifecycle = worker.stop()?;
                drop(engine);
                Some(lifecycle)
            } else {
                self.last_lifecycle
                    .lock()
                    .map_err(|_| "mobile messaging lifecycle history lock poisoned".to_string())?
                    .take()
            };
        let engine = match MobileMessagingEngine::open(
            database_path,
            profile_id,
            station_peer_id,
            station_origin,
            actor_ptid,
            device_id,
            database_key,
            actor_identity_seed,
            actor_profile_version,
            access_token,
            seed_backup,
            prekey_backup,
        ) {
            Ok(engine) => Arc::new(engine),
            Err(error) => {
                *self.last_lifecycle.lock().map_err(|_| {
                    "mobile messaging lifecycle history lock poisoned".to_string()
                })? = previous_lifecycle;
                return Err(error);
            }
        };
        let lifecycle_fallback = previous_lifecycle.clone();
        let worker =
            match MobileMessagingWorker::start(engine.clone(), previous_lifecycle, event_sink) {
                Ok(worker) => worker,
                Err(error) => {
                    *self.last_lifecycle.lock().map_err(|_| {
                        "mobile messaging lifecycle history lock poisoned".to_string()
                    })? = lifecycle_fallback;
                    return Err(error);
                }
            };
        let runtime = ActiveMessagingRuntime { engine, worker };
        let status = status_for_active(&runtime)?;
        *active = Some(runtime);
        Ok(status)
    }

    pub fn status(&self) -> MobileResult<MessagingRuntimeStatus> {
        let active = self
            .active
            .lock()
            .map_err(|_| MobileError::messaging("mobile messaging runtime lock poisoned"))?;
        active
            .as_ref()
            .map(|runtime| status_for_active(runtime).map_err(MobileError::messaging))
            .unwrap_or_else(|| Ok(MessagingRuntimeStatus::inactive()))
    }

    pub fn recover_fresh_install_identity<R: Runtime>(
        &self,
        app: AppHandle<R>,
        data_root: &Path,
        storage: &SecureStorage,
        station_peer_id: String,
        station_origin: String,
        actor_ptid: String,
        device_id: String,
        actor_identity_seed: [u8; 32],
        actor_profile_version: u64,
        access_token: String,
    ) -> MobileResult<MessagingRuntimeStatus> {
        validate_account_scope(&station_peer_id, &station_origin, &actor_ptid)
            .map_err(MobileError::messaging)?;
        if device_id.trim().is_empty() || actor_profile_version == 0 {
            return Err(MobileError::coded(
                "MOBILE_MESSAGING_IDENTITY_RECOVERY_INVALID",
                "recovered messaging identity is incomplete",
            ));
        }
        let recovered = generate_fresh_device_identity_for_device(
            &actor_ptid,
            &device_id,
            actor_identity_seed,
            actor_profile_version,
        )
        .map_err(MobileError::messaging)?;
        let mut active = self
            .active
            .lock()
            .map_err(|_| MobileError::messaging("mobile messaging runtime lock poisoned"))?;
        let current = active
            .as_ref()
            .ok_or_else(|| MobileError::messaging("mobile messaging runtime is not active"))?;
        validate_active_scope(&current.engine, &station_peer_id, &actor_ptid)?;
        if current.engine.scope().device_id != device_id {
            return Err(MobileError::coded(
                "MOBILE_MESSAGING_IDENTITY_RECOVERY_STALE_SCOPE",
                "recovered messaging identity does not match the active Session device",
            ));
        }
        let current = active
            .take()
            .ok_or_else(|| MobileError::messaging("mobile messaging runtime is not active"))?;
        drop(active);
        let lifecycle = current.worker.stop().map_err(MobileError::messaging)?;
        *self.last_lifecycle.lock().map_err(|_| {
            MobileError::messaging("mobile messaging lifecycle history lock poisoned")
        })? = Some(lifecycle);

        let user_scope = format!("{station_peer_id}|{actor_ptid}");
        let previous_seed = identity_keys::replace_identity_seed(
            storage,
            &user_scope,
            &actor_ptid,
            &actor_identity_seed,
        )?;
        if let Err(error) = current
            .engine
            .store()
            .replace_fresh_install_identity(&recovered)
        {
            let rollback = identity_keys::restore_identity_seed(
                storage,
                &user_scope,
                &actor_ptid,
                previous_seed.as_deref(),
            );
            drop(current.engine);
            let _ = self.activate(
                app,
                data_root,
                storage,
                station_peer_id,
                station_origin,
                actor_ptid,
                device_id,
                actor_profile_version,
                access_token,
            );
            if let Err(rollback_error) = rollback {
                return Err(MobileError::messaging(format!(
                    "{error}; failed to roll back actor identity: {rollback_error}"
                )));
            }
            return Err(MobileError::messaging(error));
        }
        drop(current.engine);
        self.activate(
            app,
            data_root,
            storage,
            station_peer_id,
            station_origin,
            actor_ptid,
            device_id,
            actor_profile_version,
            access_token,
        )
    }

    pub fn conversations(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> MobileResult<Vec<ConversationProjection>> {
        let engine = self.active_engine(station_peer_id, actor_ptid)?;
        engine.conversations().map_err(MobileError::messaging)
    }

    pub fn deactivate(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> MobileResult<MessagingRuntimeStatus> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| MobileError::messaging("mobile messaging runtime lock poisoned"))?;
        let Some(active_runtime) = active.as_ref() else {
            return Ok(MessagingRuntimeStatus::inactive());
        };
        validate_active_scope(&active_runtime.engine, station_peer_id, actor_ptid)?;
        let active_runtime = active
            .take()
            .ok_or_else(|| MobileError::messaging("mobile messaging runtime disappeared"))?;
        drop(active);
        let lifecycle = active_runtime
            .worker
            .stop()
            .map_err(MobileError::messaging)?;
        *self.last_lifecycle.lock().map_err(|_| {
            MobileError::messaging("mobile messaging lifecycle history lock poisoned")
        })? = Some(lifecycle);
        Ok(MessagingRuntimeStatus::inactive())
    }

    pub fn suspend(&self) -> MobileResult<()> {
        let active = self
            .active
            .lock()
            .map_err(|_| MobileError::messaging("mobile messaging runtime lock poisoned"))?;
        if let Some(runtime) = active.as_ref() {
            runtime.worker.suspend().map_err(MobileError::messaging)?;
        }
        Ok(())
    }

    pub fn resume(&self, station_peer_id: &str, actor_ptid: &str) -> MobileResult<()> {
        let active = self
            .active
            .lock()
            .map_err(|_| MobileError::messaging("mobile messaging runtime lock poisoned"))?;
        let runtime = active
            .as_ref()
            .ok_or_else(|| MobileError::messaging("mobile messaging runtime is not active"))?;
        validate_active_scope(&runtime.engine, station_peer_id, actor_ptid)?;
        runtime.worker.resume().map_err(MobileError::messaging)
    }

    pub fn wake(&self, station_peer_id: &str, actor_ptid: &str) -> MobileResult<u64> {
        let active = self
            .active
            .lock()
            .map_err(|_| MobileError::messaging("mobile messaging runtime lock poisoned"))?;
        let runtime = active
            .as_ref()
            .ok_or_else(|| MobileError::messaging("mobile messaging runtime is not active"))?;
        validate_active_scope(&runtime.engine, station_peer_id, actor_ptid)?;
        runtime.worker.wake().map_err(MobileError::messaging)
    }

    pub fn reconcile(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> MobileResult<MessagingWorkerCycleResult> {
        let (waiter, cycle_id) = self.request_reconcile(station_peer_id, actor_ptid)?;
        waiter
            .wait_for_cycle(cycle_id)
            .map_err(MobileError::messaging)
    }

    pub fn request_reconcile(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> MobileResult<(MessagingCycleWaiter, u64)> {
        let active = self
            .active
            .lock()
            .map_err(|_| MobileError::messaging("mobile messaging runtime lock poisoned"))?;
        let runtime = active
            .as_ref()
            .ok_or_else(|| MobileError::messaging("mobile messaging runtime is not active"))?;
        validate_active_scope(&runtime.engine, station_peer_id, actor_ptid)?;
        if runtime.worker.phase().map_err(MobileError::messaging)?
            == MessagingWorkerPhase::Suspended
        {
            return Err(MobileError::messaging(
                "mobile messaging worker is suspended",
            ));
        }
        let cycle_id = runtime.worker.wake().map_err(MobileError::messaging)?;
        Ok((runtime.worker.waiter(), cycle_id))
    }

    pub(crate) fn active_engine(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> MobileResult<Arc<MobileMessagingEngine>> {
        let engine = self
            .active
            .lock()
            .map_err(|_| MobileError::messaging("mobile messaging runtime lock poisoned"))?
            .as_ref()
            .map(|runtime| runtime.engine.clone())
            .ok_or_else(|| MobileError::messaging("mobile messaging runtime is not active"))?;
        validate_active_scope(&engine, station_peer_id, actor_ptid)?;
        Ok(engine)
    }

    /// Publication shares the active-runtime lock with suspend, resume and
    /// replacement. Pointer identity rejects A→B→A engine reincarnations.
    pub(crate) fn with_search_engine<T>(
        &self,
        engine: &Arc<MobileMessagingEngine>,
        publish: impl FnOnce() -> Result<T, search_core::SearchError>,
    ) -> Result<T, search_core::SearchError> {
        let active = self
            .active
            .lock()
            .map_err(|_| search_core::SearchError::Cancelled)?;
        let current = active.as_ref().ok_or(search_core::SearchError::Cancelled)?;
        if !Arc::ptr_eq(&current.engine, engine)
            || current
                .worker
                .phase()
                .map_err(|_| search_core::SearchError::Cancelled)?
                == MessagingWorkerPhase::Suspended
            || !current
                .worker
                .is_active()
                .map_err(|_| search_core::SearchError::Cancelled)?
        {
            return Err(search_core::SearchError::Cancelled);
        }
        publish()
    }

    pub(crate) fn secure_content_runtime_identity(
        &self,
        station_peer_id: &str,
        actor_ptid: &str,
    ) -> MobileResult<SecureContentRuntimeIdentity> {
        self.active_engine(station_peer_id, actor_ptid)?
            .secure_content_runtime_identity()
            .map_err(MobileError::messaging)
    }
}

struct WorkerState {
    lifecycle: EngineLifecycleRecord,
    cycle_running: bool,
    wake_pending: bool,
    completed_cycle_id: u64,
    last_result: Option<Result<MessagingWorkerCycleResult, String>>,
    retry_deadline: Option<Instant>,
}

struct WorkerCancellation(AtomicBool);

impl LifecycleCancellation for WorkerCancellation {
    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

struct MobileMessagingWorker {
    state: Arc<(Mutex<WorkerState>, Condvar)>,
    attachment_transfer_control: Arc<AttachmentTransferControl>,
    cancellation: Arc<WorkerCancellation>,
    fence: EngineFence,
    handle: Option<JoinHandle<()>>,
}

#[derive(Clone)]
pub struct MessagingCycleWaiter {
    state: Arc<(Mutex<WorkerState>, Condvar)>,
}

impl MobileMessagingWorker {
    fn start(
        engine: Arc<MobileMessagingEngine>,
        previous_lifecycle: Option<EngineLifecycleRecord>,
        event_sink: ProjectionEventSink,
    ) -> Result<Self, String> {
        let cancellation = Arc::new(WorkerCancellation(AtomicBool::new(false)));
        let endpoint = CryptoEndpoint::new(
            engine.scope().actor_ptid.clone(),
            engine.scope().device_id.clone(),
        )?;
        let baseline = match previous_lifecycle {
            Some(previous)
                if previous.endpoint == endpoint
                    && previous.station_peer_id == engine.scope().station_peer_id =>
            {
                if matches!(previous.phase, EnginePhase::Inactive | EnginePhase::Failed) {
                    previous
                } else {
                    recover_interrupted_engine(&previous, next_lifecycle_time(&previous))
                        .map_err(|error| error.to_string())?
                }
            }
            _ => EngineLifecycleRecord::inactive(
                endpoint,
                engine.scope().station_peer_id.clone(),
                now_unix_ms(),
            )
            .map_err(|error| error.to_string())?,
        };
        let starting = activate_engine(
            &baseline,
            cancellation.as_ref(),
            next_lifecycle_time(&baseline),
        )
        .map_err(|error| error.to_string())?;
        let (_, consumer_epoch) = MessagingRepository::lane_checkpoint(engine.store())?;
        let active = complete_engine_start(
            &starting,
            starting.fence(),
            consumer_epoch,
            next_lifecycle_time(&starting),
        )
        .map_err(|error| error.to_string())?;
        let fence = active.fence();
        let state = Arc::new((
            Mutex::new(WorkerState {
                lifecycle: active,
                cycle_running: false,
                wake_pending: false,
                completed_cycle_id: 0,
                last_result: None,
                retry_deadline: None,
            }),
            Condvar::new(),
        ));
        let thread_state = state.clone();
        let attachment_transfer_control = engine.attachment_transfer_control();
        let thread_engine = engine.clone();
        let thread_cancellation = cancellation.clone();
        let handle = thread::Builder::new()
            .name(format!("mobile-messaging:{}", engine.profile_id()))
            .spawn(move || {
                worker_loop(
                    thread_state,
                    thread_engine,
                    fence,
                    thread_cancellation,
                    event_sink,
                );
            })
            .map_err(|error| {
                cancellation.0.store(true, Ordering::Release);
                format!("start mobile messaging worker: {error}")
            })?;
        Ok(Self {
            state,
            attachment_transfer_control,
            cancellation,
            fence,
            handle: Some(handle),
        })
    }

    fn phase(&self) -> Result<MessagingWorkerPhase, String> {
        let lifecycle = self
            .state
            .0
            .lock()
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?
            .lifecycle
            .clone();
        Ok(presentation_phase(lifecycle.phase))
    }

    fn lifecycle_generation(&self) -> Result<u64, String> {
        self.state
            .0
            .lock()
            .map(|state| state.lifecycle.lifecycle_generation)
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())
    }

    fn is_active(&self) -> Result<bool, String> {
        let handle_running = self
            .handle
            .as_ref()
            .is_some_and(|handle| !handle.is_finished());
        if !handle_running {
            return Ok(false);
        }
        let state = self
            .state
            .0
            .lock()
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        validate_engine_fence(&state.lifecycle, self.fence).map_err(|error| error.to_string())?;
        Ok(!self.cancellation.is_cancelled()
            && matches!(
                state.lifecycle.phase,
                EnginePhase::Active | EnginePhase::Suspended
            ))
    }

    fn wake(&self) -> Result<u64, String> {
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        validate_active_engine(&state.lifecycle, self.fence, self.cancellation.as_ref())
            .map_err(|error| error.to_string())?;
        let target_cycle = if state.cycle_running {
            state.completed_cycle_id + 2
        } else {
            state.completed_cycle_id + 1
        };
        if !state.wake_pending {
            state.wake_pending = true;
        }
        state.retry_deadline = None;
        wake.notify_all();
        Ok(target_cycle)
    }

    fn suspend(&self) -> Result<(), String> {
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        validate_active_engine(&state.lifecycle, self.fence, self.cancellation.as_ref())
            .map_err(|error| error.to_string())?;
        let consumer_epoch = state.lifecycle.consumer_epoch;
        state.lifecycle = suspend_engine(
            &state.lifecycle,
            self.fence,
            consumer_epoch,
            next_lifecycle_time(&state.lifecycle),
        )
        .map_err(|error| error.to_string())?;
        wake.notify_all();
        while state.cycle_running {
            state = wake
                .wait(state)
                .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        }
        Ok(())
    }

    fn resume(&self) -> Result<(), String> {
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        state.lifecycle = resume_engine(
            &state.lifecycle,
            self.fence,
            self.cancellation.as_ref(),
            next_lifecycle_time(&state.lifecycle),
        )
        .map_err(|error| error.to_string())?;
        state.wake_pending = true;
        state.retry_deadline = None;
        wake.notify_all();
        Ok(())
    }

    fn waiter(&self) -> MessagingCycleWaiter {
        MessagingCycleWaiter {
            state: self.state.clone(),
        }
    }

    fn stop(mut self) -> Result<EngineLifecycleRecord, String> {
        self.request_stop()?;
        self.join_and_complete()
    }

    fn request_stop(&self) -> Result<(), String> {
        self.attachment_transfer_control.request_shutdown();
        self.cancellation.0.store(true, Ordering::Release);
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        if !matches!(
            state.lifecycle.phase,
            EnginePhase::Inactive | EnginePhase::Stopping
        ) {
            state.lifecycle = begin_engine_stop(
                &state.lifecycle,
                self.fence,
                next_lifecycle_time(&state.lifecycle),
            )
            .map_err(|error| error.to_string())?;
        }
        state.wake_pending = false;
        state.retry_deadline = None;
        wake.notify_all();
        Ok(())
    }

    fn join_and_complete(&mut self) -> Result<EngineLifecycleRecord, String> {
        if let Some(handle) = self.handle.take() {
            handle
                .join()
                .map_err(|_| "mobile messaging worker panicked".to_string())?;
        }
        let mut state = self
            .state
            .0
            .lock()
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        if state.lifecycle.phase != EnginePhase::Inactive {
            state.lifecycle = complete_engine_stop(
                &state.lifecycle,
                self.fence,
                next_lifecycle_time(&state.lifecycle),
            )
            .map_err(|error| error.to_string())?;
        }
        Ok(state.lifecycle.clone())
    }
}

impl MessagingCycleWaiter {
    pub fn wait_for_cycle(&self, cycle_id: u64) -> Result<MessagingWorkerCycleResult, String> {
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        while state.completed_cycle_id < cycle_id {
            if matches!(
                state.lifecycle.phase,
                EnginePhase::Inactive | EnginePhase::Stopping | EnginePhase::Failed
            ) {
                return Err("mobile messaging worker stopped before reconcile".to_string());
            }
            state = wake
                .wait(state)
                .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        }
        state
            .last_result
            .clone()
            .unwrap_or_else(|| Err("mobile messaging worker has no cycle result".to_string()))
    }
}

impl Drop for MobileMessagingWorker {
    fn drop(&mut self) {
        if self.handle.is_none() {
            return;
        }
        let _ = self.request_stop();
        let _ = self.join_and_complete();
    }
}

fn worker_loop(
    state: Arc<(Mutex<WorkerState>, Condvar)>,
    engine: Arc<MobileMessagingEngine>,
    fence: EngineFence,
    cancellation: Arc<WorkerCancellation>,
    event_sink: ProjectionEventSink,
) {
    loop {
        let cycle_id = {
            let mut guard = match state.0.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            loop {
                if cancellation.is_cancelled()
                    || matches!(
                        guard.lifecycle.phase,
                        EnginePhase::Inactive | EnginePhase::Stopping | EnginePhase::Failed
                    )
                {
                    return;
                }
                let retry_due = guard
                    .retry_deadline
                    .is_some_and(|deadline| deadline <= Instant::now());
                if guard.lifecycle.phase == EnginePhase::Active && (guard.wake_pending || retry_due)
                {
                    guard.wake_pending = false;
                    guard.retry_deadline = None;
                    guard.cycle_running = true;
                    break guard.completed_cycle_id + 1;
                }
                guard = match guard.retry_deadline {
                    Some(deadline) if guard.lifecycle.phase == EnginePhase::Active => {
                        let timeout = deadline.saturating_duration_since(Instant::now());
                        match state.1.wait_timeout(guard, timeout) {
                            Ok((next, _)) => next,
                            Err(_) => return,
                        }
                    }
                    _ => match state.1.wait(guard) {
                        Ok(next) => next,
                        Err(_) => return,
                    },
                };
            }
        };

        // Local derived-index repair has no network prerequisite. Yield the
        // Store lock between 128-row batches and recheck the lifecycle fence.
        match engine.store().rebuild_search_index_batch() {
            Ok(false) => {
                let mut guard = match state.0.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                guard.cycle_running = false;
                if validate_active_engine(&guard.lifecycle, fence, cancellation.as_ref()).is_ok() {
                    guard.wake_pending = true;
                }
                state.1.notify_all();
                continue;
            }
            Ok(true) => {}
            Err(error) => log::warn!("mobile messaging index repair remains pending: {error}"),
        }
        let (mut result, backlog, retry_deadline) = run_worker_batch(
            &state,
            engine.as_ref(),
            fence,
            cancellation.as_ref(),
            cycle_id,
            &event_sink,
        );
        if let Err(error) = &result {
            log::warn!("mobile messaging worker cycle failed: {error}");
        }
        let mut guard = match state.0.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if let Ok(cycle) = &result {
            match advance_engine_consumer_epoch(&guard.lifecycle, fence, cycle.drain.consumer_epoch)
            {
                Ok(lifecycle) => guard.lifecycle = lifecycle,
                Err(error) => result = Err(error.to_string()),
            }
        }
        guard.cycle_running = false;
        guard.completed_cycle_id = cycle_id;
        guard.last_result = Some(result);
        if validate_active_engine(&guard.lifecycle, fence, cancellation.as_ref()).is_ok() {
            guard.wake_pending |= backlog;
            guard.retry_deadline = retry_deadline;
        }
        state.1.notify_all();
    }
}

fn run_worker_batch(
    state: &Arc<(Mutex<WorkerState>, Condvar)>,
    engine: &MobileMessagingEngine,
    fence: EngineFence,
    cancellation: &dyn LifecycleCancellation,
    cycle_id: u64,
    event_sink: &ProjectionEventSink,
) -> (
    Result<MessagingWorkerCycleResult, String>,
    bool,
    Option<Instant>,
) {
    let mut last_result = None;
    let mut retry_deadline = None;
    for _ in 0..MAX_CONTINUATION_CYCLES {
        if !worker_is_running(state, fence, cancellation) {
            break;
        }
        match run_engine_cycle(state, engine, fence, cancellation, cycle_id, event_sink) {
            Ok(Some((result, has_backlog, next_retry))) => {
                retry_deadline = earlier_deadline(retry_deadline, next_retry);
                last_result = Some(Ok(result));
                if !has_backlog {
                    return (
                        last_result.expect("worker cycle result exists"),
                        false,
                        retry_deadline,
                    );
                }
            }
            Ok(None) => break,
            Err(error) => {
                let _ = engine.recover_stale_enrollment(&error);
                return (
                    Err(error),
                    false,
                    Some(Instant::now() + FAILURE_RETRY_DELAY),
                );
            }
        }
    }
    let has_backlog = last_result.is_some();
    (
        last_result.unwrap_or_else(|| Err("mobile messaging worker suspended".to_string())),
        has_backlog,
        retry_deadline,
    )
}

fn run_engine_cycle(
    state: &Arc<(Mutex<WorkerState>, Condvar)>,
    engine: &MobileMessagingEngine,
    fence: EngineFence,
    cancellation: &dyn LifecycleCancellation,
    cycle_id: u64,
    event_sink: &ProjectionEventSink,
) -> Result<Option<(MessagingWorkerCycleResult, bool, Option<Instant>)>, String> {
    let enrollment = engine.enroll_pending_device();
    let enrolled_now = enrollment?.is_some();
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    let repaired_projection_scopes = engine.hydrate_conversation_authority_scopes()?;
    if repaired_projection_scopes > 0 {
        log::info!(
            "mobile messaging repaired {repaired_projection_scopes} Conversation authority scopes"
        );
    }
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    engine.publish_prekeys()?;
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    engine.publish_mls_key_packages()?;
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    let membership_reprepared = engine.resume_membership_intent_once()?;
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }

    let now = now_unix_ms();
    let attachment_upload_result = engine.resume_attachment_upload_once(now);
    let attachment_upload_progressed = attachment_upload_result?;
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    let attachment_download_progressed = engine.resume_attachment_download_once(now)?;
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    let draft_result = engine.resume_message_draft_once(now);
    let draft = draft_result?;
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    let reconciliation = engine.reconcile_submitted_commands_once()?;
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    let interaction_reprepared = engine.resume_superseded_interaction_once()?;
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    let command_result = engine.dispatch_command_once();
    let command = command_result?;
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    let station_peer_id = engine.scope().station_peer_id.clone();
    let actor_ptid = engine.scope().actor_ptid.clone();
    let profile_id = engine.profile_id().to_string();
    let projection_sink = event_sink.clone();
    let drain = engine.drain_once_with_observer(Some(Arc::new(move |item| {
        if let Err(error) = projection_sink(MessagingProjectionEvent {
            station_peer_id: station_peer_id.clone(),
            actor_ptid: actor_ptid.clone(),
            profile_id: profile_id.clone(),
            activation_generation: fence.lifecycle_generation,
            cycle_id,
            conversation_id: item.conversation_id.clone(),
            event_id: item.event_id.clone(),
            lane_sequence: item.lane_sequence,
        }) {
            log::warn!("mobile messaging projection event delivery failed: {error}");
        }
    })))?;
    if !worker_is_running(state, fence, cancellation) {
        return Ok(None);
    }
    let attachment_sources_cleaned = engine.cleanup_completed_attachment_sources()?;
    let delivery_receipt_submitted = engine.dispatch_delivery_receipt_once()?;
    let device_enrolled = engine.store().pending_device_enrollment()?.is_none();
    let retry_deadline = earlier_deadline(
        draft_retry_deadline(&draft, now),
        command_retry_deadline(&command, now),
    );
    let retry_deadline = earlier_deadline(
        retry_deadline,
        engine
            .next_scheduled_work_at()?
            .map(|next| unix_retry_deadline(next, now)),
    );
    let retry_deadline = earlier_deadline(
        retry_deadline,
        reconciliation_retry_deadline(&reconciliation, now),
    );
    let has_backlog = enrolled_now
        || attachment_upload_progressed
        || attachment_download_progressed
        || attachment_sources_cleaned > 0
        || matches!(draft, MessageDraftResumeProgress::Prepared)
        || membership_reprepared
        || interaction_reprepared
        || reconciliation.has_immediate_follow_up()
        || !matches!(
            command,
            CommandDispatchProgress::Idle | CommandDispatchProgress::RetryScheduled { .. }
        )
        || drain.cursor < drain.lane_head
        || delivery_receipt_submitted;
    Ok(Some((
        MessagingWorkerCycleResult {
            device_enrolled,
            drain,
            delivery_receipt_submitted,
            reconciliation,
            command,
        },
        has_backlog,
        retry_deadline,
    )))
}

fn worker_is_running(
    state: &Arc<(Mutex<WorkerState>, Condvar)>,
    fence: EngineFence,
    cancellation: &dyn LifecycleCancellation,
) -> bool {
    state
        .0
        .lock()
        .map(|state| validate_active_engine(&state.lifecycle, fence, cancellation).is_ok())
        .unwrap_or(false)
}

fn draft_retry_deadline(
    progress: &MessageDraftResumeProgress,
    now_unix_ms: i64,
) -> Option<Instant> {
    match progress {
        MessageDraftResumeProgress::RetryScheduled {
            next_attempt_at_unix_ms,
        } => Some(unix_retry_deadline(*next_attempt_at_unix_ms, now_unix_ms)),
        MessageDraftResumeProgress::Idle | MessageDraftResumeProgress::Prepared => None,
    }
}

fn command_retry_deadline(progress: &CommandDispatchProgress, now_unix_ms: i64) -> Option<Instant> {
    match progress {
        CommandDispatchProgress::RetryScheduled {
            next_attempt_at_unix_ms,
            ..
        } => Some(unix_retry_deadline(*next_attempt_at_unix_ms, now_unix_ms)),
        _ => None,
    }
}

fn reconciliation_retry_deadline(
    progress: &CommandReconciliationProgress,
    now_unix_ms: i64,
) -> Option<Instant> {
    progress
        .next_reconciliation_at_unix_ms()
        .map(|next| unix_retry_deadline(next, now_unix_ms))
}

fn unix_retry_deadline(next_attempt_at_unix_ms: i64, now_unix_ms: i64) -> Instant {
    Instant::now()
        + Duration::from_millis(next_attempt_at_unix_ms.saturating_sub(now_unix_ms).max(0) as u64)
}

fn earlier_deadline(left: Option<Instant>, right: Option<Instant>) -> Option<Instant> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(deadline), None) | (None, Some(deadline)) => Some(deadline),
        (None, None) => None,
    }
}

fn validate_active_scope(
    engine: &MobileMessagingEngine,
    station_peer_id: &str,
    actor_ptid: &str,
) -> MobileResult<()> {
    if engine.scope().station_peer_id != station_peer_id.trim()
        || engine.scope().actor_ptid != actor_ptid.trim()
    {
        return Err(MobileError::messaging(
            "mobile messaging runtime account scope mismatch",
        ));
    }
    Ok(())
}

fn status_for_active(runtime: &ActiveMessagingRuntime) -> Result<MessagingRuntimeStatus, String> {
    if !runtime.worker.is_active()? {
        return Err("mobile messaging worker terminated".to_string());
    }
    let engine = runtime.engine.as_ref();
    let (lane_sequence, consumer_epoch) = MessagingRepository::lane_checkpoint(engine.store())?;
    Ok(MessagingRuntimeStatus {
        active: true,
        profile_id: Some(engine.profile_id().to_string()),
        station_peer_id: Some(engine.scope().station_peer_id.clone()),
        station_origin: Some(engine.scope().station_origin.clone()),
        actor_ptid: Some(engine.scope().actor_ptid.clone()),
        device_id: Some(engine.scope().device_id.clone()),
        device_enrolled: engine.store().pending_device_enrollment()?.is_none(),
        lane_sequence,
        consumer_epoch,
        conversation_count: engine.conversations()?.len(),
        activation_generation: runtime.worker.lifecycle_generation()?,
        worker_phase: runtime.worker.phase()?,
    })
}

fn presentation_phase(phase: EnginePhase) -> MessagingWorkerPhase {
    match phase {
        EnginePhase::Starting | EnginePhase::Active => MessagingWorkerPhase::Running,
        EnginePhase::Suspended => MessagingWorkerPhase::Suspended,
        EnginePhase::Inactive | EnginePhase::Stopping | EnginePhase::Failed => {
            MessagingWorkerPhase::Stopping
        }
    }
}

fn next_lifecycle_time(record: &EngineLifecycleRecord) -> i64 {
    now_unix_ms().max(record.updated_at_unix_ms.saturating_add(1))
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn profile_id(station_peer_id: &str, actor_ptid: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(station_peer_id.as_bytes());
    hasher.update([0x1f]);
    hasher.update(actor_ptid.as_bytes());
    hex_bytes(&hasher.finalize())
}

fn database_path(data_root: &Path, profile_id: &str) -> MobileResult<PathBuf> {
    let directory = data_root.join("messaging");
    std::fs::create_dir_all(&directory).map_err(|error| {
        MobileError::messaging(format!("create mobile messaging data directory: {error}"))
    })?;
    Ok(directory.join(format!("{profile_id}.sqlite3")))
}

fn load_or_create_database_key(
    storage: &SecureStorage,
    profile_id: &str,
) -> MobileResult<Zeroizing<[u8; 32]>> {
    let key_name = format!("{DATABASE_KEY_PREFIX}.{profile_id}");
    if let Some(encoded) = storage.get(&key_name)? {
        let decoded = B64.decode(encoded.trim()).map_err(|error| {
            MobileError::messaging(format!("decode mobile messaging database key: {error}"))
        })?;
        let key = decoded.try_into().map_err(|value: Vec<u8>| {
            MobileError::messaging(format!(
                "mobile messaging database key has invalid length: {}",
                value.len()
            ))
        })?;
        return Ok(Zeroizing::new(key));
    }
    let mut key = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(key.as_mut());
    storage.set(&key_name, &B64.encode(key.as_slice()))?;
    Ok(key)
}

fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discard_events() -> ProjectionEventSink {
        Arc::new(|_| Ok(()))
    }

    fn temp_database(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "peers-mobile-messaging-runtime-{name}-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn idle_worker() -> MobileMessagingWorker {
        let cancellation = Arc::new(WorkerCancellation(AtomicBool::new(false)));
        let inactive = EngineLifecycleRecord::inactive(
            CryptoEndpoint::new("ptid:alice", "mobile-device-1").unwrap(),
            "station-1",
            1,
        )
        .unwrap();
        let starting = activate_engine(&inactive, cancellation.as_ref(), 2).unwrap();
        let active = complete_engine_start(&starting, starting.fence(), 0, 3).unwrap();
        let fence = active.fence();
        MobileMessagingWorker {
            state: Arc::new((
                Mutex::new(WorkerState {
                    lifecycle: active,
                    cycle_running: false,
                    wake_pending: false,
                    completed_cycle_id: 4,
                    last_result: None,
                    retry_deadline: None,
                }),
                Condvar::new(),
            )),
            attachment_transfer_control: Arc::new(AttachmentTransferControl::new()),
            cancellation,
            fence,
            handle: None,
        }
    }

    #[test]
    fn worker_wakes_are_coalesced_and_lifecycle_is_explicit() {
        let worker = idle_worker();
        assert_eq!(worker.wake().unwrap(), 5);
        assert_eq!(worker.wake().unwrap(), 5);

        {
            let mut state = worker.state.0.lock().unwrap();
            state.wake_pending = false;
            state.cycle_running = true;
        }
        assert_eq!(worker.wake().unwrap(), 6);
        assert_eq!(worker.wake().unwrap(), 6);

        {
            let mut state = worker.state.0.lock().unwrap();
            state.cycle_running = false;
        }
        worker.suspend().unwrap();
        assert_eq!(worker.phase().unwrap(), MessagingWorkerPhase::Suspended);
        worker.resume().unwrap();
        assert_eq!(worker.phase().unwrap(), MessagingWorkerPhase::Running);
    }

    #[test]
    fn retry_deadlines_preserve_the_earliest_due_work() {
        let now = now_unix_ms();
        let draft = draft_retry_deadline(
            &MessageDraftResumeProgress::RetryScheduled {
                next_attempt_at_unix_ms: now + 2_000,
            },
            now,
        )
        .unwrap();
        let command = command_retry_deadline(
            &CommandDispatchProgress::RetryScheduled {
                command_id: "command-1".to_string(),
                next_attempt_at_unix_ms: now + 5_000,
            },
            now,
        )
        .unwrap();
        assert_eq!(earlier_deadline(Some(draft), Some(command)), Some(draft));
    }

    #[test]
    fn home_pending_reconciliation_waits_for_its_bounded_deadline() {
        let now = now_unix_ms();
        let reconciliation = CommandReconciliationProgress::Reconciled {
            command_count: 1,
            transition_count: 0,
            retry_count: 0,
            next_reconciliation_at_unix_ms: Some(now + 1_000),
            terminal_membership_conversations: Vec::new(),
        };

        assert!(!reconciliation.has_immediate_follow_up());
        assert!(reconciliation_retry_deadline(&reconciliation, now).is_some());
    }

    #[test]
    fn activation_is_idempotent_only_for_the_same_account_scope() {
        let runtime = MobileMessagingRuntime::default();
        let path = temp_database("scope");
        let first = runtime
            .activate_with_material(
                &path,
                "profile-1".to_string(),
                "station-1".to_string(),
                "https://station.example".to_string(),
                "ptid:alice".to_string(),
                "mobile-device-1".to_string(),
                &[7; 32],
                [8; 32],
                1,
                "token-1".to_string(),
                discard_events(),
                &crate::messaging::engine::NoopSeedBackup,
                crate::messaging::engine::noop_prekey_backup(),
            )
            .unwrap();
        assert!(first.active);
        assert_eq!(first.actor_ptid.as_deref(), Some("ptid:alice"));

        let repeated = runtime
            .activate_with_material(
                &path,
                "profile-1".to_string(),
                "station-1".to_string(),
                "https://station.example".to_string(),
                "ptid:alice".to_string(),
                "mobile-device-1".to_string(),
                &[7; 32],
                [8; 32],
                1,
                "token-2".to_string(),
                discard_events(),
                &crate::messaging::engine::NoopSeedBackup,
                crate::messaging::engine::noop_prekey_backup(),
            )
            .unwrap();
        assert_eq!(repeated.profile_id, first.profile_id);
        assert_eq!(repeated.activation_generation, first.activation_generation);

        let refreshed_origin = runtime
            .activate_with_material(
                &path,
                "profile-1".to_string(),
                "station-1".to_string(),
                "https://station-new.example".to_string(),
                "ptid:alice".to_string(),
                "mobile-device-1".to_string(),
                &[7; 32],
                [8; 32],
                1,
                "token-3".to_string(),
                discard_events(),
                &crate::messaging::engine::NoopSeedBackup,
                crate::messaging::engine::noop_prekey_backup(),
            )
            .unwrap();
        assert_eq!(
            refreshed_origin.activation_generation,
            first.activation_generation + 1
        );
        assert_eq!(
            refreshed_origin.station_origin.as_deref(),
            Some("https://station-new.example")
        );
        assert!(runtime
            .activate_with_material(
                &temp_database("other"),
                "profile-2".to_string(),
                "station-1".to_string(),
                "https://station.example".to_string(),
                "ptid:bob".to_string(),
                "mobile-device-2".to_string(),
                &[9; 32],
                [10; 32],
                1,
                "token-4".to_string(),
                discard_events(),
                &crate::messaging::engine::NoopSeedBackup,
                crate::messaging::engine::noop_prekey_backup(),
            )
            .is_err());
        assert!(runtime.deactivate("station-1", "ptid:bob").is_err());
        assert!(
            !runtime
                .deactivate("station-1", "ptid:alice")
                .unwrap()
                .active
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn reopening_profile_preserves_mls_signing_identity() {
        let path = temp_database("restart");
        let key = [11; 32];
        let first = MobileMessagingEngine::open(
            &path,
            "profile-1".to_string(),
            "station-1".to_string(),
            "https://station.example".to_string(),
            "ptid:alice".to_string(),
            "mobile-device-1".to_string(),
            &key,
            [12; 32],
            1,
            "token-1".to_string(),
            &crate::messaging::engine::NoopSeedBackup,
            crate::messaging::engine::noop_prekey_backup(),
        )
        .unwrap();
        let first_device_id = first.scope().device_id.clone();
        let first_identity_state = first.store().load_mls_actor_identity().unwrap().unwrap().2;
        drop(first);

        let reopened = MobileMessagingEngine::open(
            &path,
            "profile-1".to_string(),
            "station-1".to_string(),
            "https://station.example".to_string(),
            "ptid:alice".to_string(),
            "mobile-device-1".to_string(),
            &key,
            [12; 32],
            1,
            "token-2".to_string(),
            &crate::messaging::engine::NoopSeedBackup,
            crate::messaging::engine::noop_prekey_backup(),
        )
        .unwrap();
        assert_eq!(reopened.scope().device_id, first_device_id);
        assert_eq!(
            reopened
                .store()
                .load_mls_actor_identity()
                .unwrap()
                .unwrap()
                .2,
            first_identity_state
        );
        let _ = std::fs::remove_file(path);
    }
}
