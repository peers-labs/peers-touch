use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use messaging_core::attachment::AttachmentTransferControl;
use messaging_core::contracts::ConversationProjection;
use messaging_core::identity::DeviceEnrollmentRepository;
use messaging_core::inbox::DrainProgress;
use messaging_core::outbox::CommandDispatchProgress;
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

use super::engine::{validate_account_scope, MessageDraftResumeProgress, MobileMessagingEngine};

const DATABASE_KEY_PREFIX: &str = "messaging.v1.sqlcipher";
const MAX_CONTINUATION_CYCLES: usize = 8;
const FAILURE_RETRY_DELAY: Duration = Duration::from_secs(1);
pub const MOBILE_MESSAGING_PROJECTION_EVENT: &str = "mobile:messaging-projection-changed";

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
    activation_generation: u64,
}

#[derive(Default)]
pub struct MobileMessagingRuntime {
    active: Mutex<Option<ActiveMessagingRuntime>>,
    next_activation_generation: AtomicU64,
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
        access_token: String,
    ) -> MobileResult<MessagingRuntimeStatus> {
        let station_peer_id = station_peer_id.trim().to_string();
        let station_origin = station_origin.trim_end_matches('/').to_string();
        let actor_ptid = actor_ptid.trim().to_string();
        validate_account_scope(&station_peer_id, &station_origin, &actor_ptid)
            .map_err(MobileError::messaging)?;
        let user_scope = format!("{station_peer_id}|{actor_ptid}");
        let actor_identity = identity_keys::ensure_identity(storage, &user_scope, &actor_ptid)?;
        let actor_identity_seed = actor_identity.signing_key.to_bytes();
        let profile_id = profile_id(&station_peer_id, &actor_ptid);
        let database_key = load_or_create_database_key(storage, &profile_id)?;
        let database_path = database_path(data_root, &profile_id)?;
        let event_sink: ProjectionEventSink = Arc::new(move |event| {
            app.emit(MOBILE_MESSAGING_PROJECTION_EVENT, event)
                .map_err(|error| format!("emit mobile messaging projection event: {error}"))
        });
        let wake_station_peer_id = station_peer_id.clone();
        let wake_actor_ptid = actor_ptid.clone();
        let status = self
            .activate_with_material(
                &database_path,
                profile_id,
                station_peer_id,
                station_origin,
                actor_ptid,
                &database_key,
                actor_identity_seed,
                access_token,
                event_sink,
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
        database_key: &[u8; 32],
        actor_identity_seed: [u8; 32],
        access_token: String,
        event_sink: ProjectionEventSink,
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
            {
                return Err(
                    "mobile messaging runtime is already bound to another account".to_string(),
                );
            }
            if runtime.engine.scope().station_origin == station_origin
                && runtime.worker.is_active()?
            {
                runtime.engine.refresh_access_token(access_token)?;
                runtime.worker.resume()?;
                return status_for_active(runtime);
            }
        }
        if let Some(ActiveMessagingRuntime { engine, worker, .. }) = active.take() {
            worker.stop()?;
            drop(engine);
        }
        let engine = Arc::new(MobileMessagingEngine::open(
            database_path,
            profile_id,
            station_peer_id,
            station_origin,
            actor_ptid,
            database_key,
            actor_identity_seed,
            access_token,
        )?);
        let activation_generation = self
            .next_activation_generation
            .load(Ordering::Acquire)
            .checked_add(1)
            .ok_or_else(|| "mobile messaging activation generation overflow".to_string())?;
        let worker =
            MobileMessagingWorker::start(engine.clone(), activation_generation, event_sink)?;
        let runtime = ActiveMessagingRuntime {
            engine,
            worker,
            activation_generation,
        };
        let status = status_for_active(&runtime)?;
        *active = Some(runtime);
        self.next_activation_generation
            .store(activation_generation, Ordering::Release);
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
        active_runtime
            .worker
            .stop()
            .map_err(MobileError::messaging)?;
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
}

struct WorkerState {
    phase: MessagingWorkerPhase,
    cycle_running: bool,
    wake_pending: bool,
    completed_cycle_id: u64,
    last_result: Option<Result<MessagingWorkerCycleResult, String>>,
    retry_deadline: Option<Instant>,
}

struct MobileMessagingWorker {
    state: Arc<(Mutex<WorkerState>, Condvar)>,
    attachment_transfer_control: Arc<AttachmentTransferControl>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Clone)]
pub struct MessagingCycleWaiter {
    state: Arc<(Mutex<WorkerState>, Condvar)>,
}

impl MobileMessagingWorker {
    fn start(
        engine: Arc<MobileMessagingEngine>,
        activation_generation: u64,
        event_sink: ProjectionEventSink,
    ) -> Result<Self, String> {
        let state = Arc::new((
            Mutex::new(WorkerState {
                phase: MessagingWorkerPhase::Running,
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
        let handle = thread::Builder::new()
            .name(format!("mobile-messaging:{}", engine.profile_id()))
            .spawn(move || {
                worker_loop(
                    thread_state,
                    thread_engine,
                    activation_generation,
                    event_sink,
                );
            })
            .map_err(|error| format!("start mobile messaging worker: {error}"))?;
        Ok(Self {
            state,
            attachment_transfer_control,
            handle: Some(handle),
        })
    }

    fn phase(&self) -> Result<MessagingWorkerPhase, String> {
        self.state
            .0
            .lock()
            .map(|state| state.phase)
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
        self.state
            .0
            .lock()
            .map(|state| state.phase != MessagingWorkerPhase::Stopping)
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())
    }

    fn wake(&self) -> Result<u64, String> {
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        if state.phase == MessagingWorkerPhase::Stopping {
            return Err("mobile messaging worker is stopping".to_string());
        }
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
        if state.phase == MessagingWorkerPhase::Stopping {
            return Err("mobile messaging worker is stopping".to_string());
        }
        state.phase = MessagingWorkerPhase::Suspended;
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
        if state.phase == MessagingWorkerPhase::Stopping {
            return Err("mobile messaging worker is stopping".to_string());
        }
        state.phase = MessagingWorkerPhase::Running;
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

    fn stop(mut self) -> Result<(), String> {
        self.attachment_transfer_control.request_shutdown();
        {
            let (state, wake) = self.state.as_ref();
            let mut state = state
                .lock()
                .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
            state.phase = MessagingWorkerPhase::Stopping;
            state.wake_pending = false;
            state.retry_deadline = None;
            wake.notify_all();
        }
        if let Some(handle) = self.handle.take() {
            handle
                .join()
                .map_err(|_| "mobile messaging worker panicked".to_string())?;
        }
        Ok(())
    }
}

impl MessagingCycleWaiter {
    pub fn wait_for_cycle(&self, cycle_id: u64) -> Result<MessagingWorkerCycleResult, String> {
        let (state, wake) = self.state.as_ref();
        let mut state = state
            .lock()
            .map_err(|_| "mobile messaging worker state lock poisoned".to_string())?;
        while state.completed_cycle_id < cycle_id {
            if state.phase == MessagingWorkerPhase::Stopping {
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
        self.attachment_transfer_control.request_shutdown();
        if let Ok(mut state) = self.state.0.lock() {
            state.phase = MessagingWorkerPhase::Stopping;
            self.state.1.notify_all();
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn worker_loop(
    state: Arc<(Mutex<WorkerState>, Condvar)>,
    engine: Arc<MobileMessagingEngine>,
    activation_generation: u64,
    event_sink: ProjectionEventSink,
) {
    loop {
        let cycle_id = {
            let mut guard = match state.0.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            loop {
                if guard.phase == MessagingWorkerPhase::Stopping {
                    return;
                }
                let retry_due = guard
                    .retry_deadline
                    .is_some_and(|deadline| deadline <= Instant::now());
                if guard.phase == MessagingWorkerPhase::Running && (guard.wake_pending || retry_due)
                {
                    guard.wake_pending = false;
                    guard.retry_deadline = None;
                    guard.cycle_running = true;
                    break guard.completed_cycle_id + 1;
                }
                guard = match guard.retry_deadline {
                    Some(deadline) if guard.phase == MessagingWorkerPhase::Running => {
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

        let (result, backlog, retry_deadline) = run_worker_batch(
            &state,
            engine.as_ref(),
            activation_generation,
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
        guard.cycle_running = false;
        guard.completed_cycle_id = cycle_id;
        guard.last_result = Some(result);
        if guard.phase == MessagingWorkerPhase::Running {
            guard.wake_pending |= backlog;
            guard.retry_deadline = retry_deadline;
        }
        state.1.notify_all();
    }
}

fn run_worker_batch(
    state: &Arc<(Mutex<WorkerState>, Condvar)>,
    engine: &MobileMessagingEngine,
    activation_generation: u64,
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
        if !worker_is_running(state) {
            break;
        }
        match run_engine_cycle(state, engine, activation_generation, cycle_id, event_sink) {
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
    activation_generation: u64,
    cycle_id: u64,
    event_sink: &ProjectionEventSink,
) -> Result<Option<(MessagingWorkerCycleResult, bool, Option<Instant>)>, String> {
    let enrolled_now = engine.enroll_pending_device()?.is_some();
    if !worker_is_running(state) {
        return Ok(None);
    }
    let repaired_projection_scopes = engine.hydrate_conversation_authority_scopes()?;
    if repaired_projection_scopes > 0 {
        log::info!(
            "mobile messaging repaired {repaired_projection_scopes} Conversation authority scopes"
        );
    }
    if !worker_is_running(state) {
        return Ok(None);
    }
    engine.publish_prekeys()?;
    if !worker_is_running(state) {
        return Ok(None);
    }
    engine.publish_mls_key_packages()?;
    if !worker_is_running(state) {
        return Ok(None);
    }

    let now = now_unix_ms();
    let attachment_upload_result = engine.resume_attachment_upload_once(now);
    // #region debug-point A:attachment-upload-cycle
    {
        let debug_data = match &attachment_upload_result {
            Ok(progressed) => serde_json::json!({"progressed": progressed, "error": null}),
            Err(error) => serde_json::json!({"progressed": false, "error": error}),
        };
        thread::spawn(move || {
            let _ = reqwest::blocking::Client::new().post("http://100.86.255.160:7785/event").header("Content-Type", "application/json").body(serde_json::json!({"sessionId":"mobile-attachment-delivery","runId":"post-fix","hypothesisId":"A","location":"apps/mobile/src-tauri/src/messaging/lifecycle.rs:run_engine_cycle.attachment_upload","msg":"[DEBUG] Mobile attachment upload cycle completed","data":debug_data}).to_string()).send();
        });
    }
    // #endregion
    let attachment_upload_progressed = attachment_upload_result?;
    if !worker_is_running(state) {
        return Ok(None);
    }
    let attachment_download_progressed = engine.resume_attachment_download_once(now)?;
    if !worker_is_running(state) {
        return Ok(None);
    }
    let draft_result = engine.resume_message_draft_once(now);
    // #region debug-point A:attachment-draft-cycle
    {
        let debug_data = match &draft_result {
            Ok(progress) => serde_json::json!({"progress": format!("{progress:?}"), "error": null}),
            Err(error) => serde_json::json!({"progress": null, "error": error}),
        };
        thread::spawn(move || {
            let _ = reqwest::blocking::Client::new().post("http://100.86.255.160:7785/event").header("Content-Type", "application/json").body(serde_json::json!({"sessionId":"mobile-attachment-delivery","runId":"post-fix","hypothesisId":"A","location":"apps/mobile/src-tauri/src/messaging/lifecycle.rs:run_engine_cycle.message_draft","msg":"[DEBUG] Mobile attachment draft cycle completed","data":debug_data}).to_string()).send();
        });
    }
    // #endregion
    let draft = draft_result?;
    if !worker_is_running(state) {
        return Ok(None);
    }
    let interaction_reprepared = engine.resume_superseded_interaction_once()?;
    if !worker_is_running(state) {
        return Ok(None);
    }
    let command_result = engine.dispatch_command_once();
    // #region debug-point A-B:attachment-command-cycle
    {
        let debug_data = match &command_result {
            Ok(progress) => serde_json::json!({"progress": format!("{progress:?}"), "error": null}),
            Err(error) => serde_json::json!({"progress": null, "error": error}),
        };
        thread::spawn(move || {
            let _ = reqwest::blocking::Client::new().post("http://100.86.255.160:7785/event").header("Content-Type", "application/json").body(serde_json::json!({"sessionId":"mobile-attachment-delivery","runId":"post-fix","hypothesisId":"A-B","location":"apps/mobile/src-tauri/src/messaging/lifecycle.rs:run_engine_cycle.command","msg":"[DEBUG] Mobile attachment command cycle completed","data":debug_data}).to_string()).send();
        });
    }
    // #endregion
    let command = command_result?;
    if !worker_is_running(state) {
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
            activation_generation,
            cycle_id,
            conversation_id: item.conversation_id.clone(),
            event_id: item.event_id.clone(),
            lane_sequence: item.lane_sequence,
        }) {
            log::warn!("mobile messaging projection event delivery failed: {error}");
        }
    })))?;
    if !worker_is_running(state) {
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
    let has_backlog = enrolled_now
        || attachment_upload_progressed
        || attachment_download_progressed
        || attachment_sources_cleaned > 0
        || matches!(draft, MessageDraftResumeProgress::Prepared)
        || interaction_reprepared
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
            command,
        },
        has_backlog,
        retry_deadline,
    )))
}

fn worker_is_running(state: &Arc<(Mutex<WorkerState>, Condvar)>) -> bool {
    state
        .0
        .lock()
        .map(|state| state.phase == MessagingWorkerPhase::Running)
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
        activation_generation: runtime.activation_generation,
        worker_phase: runtime.worker.phase()?,
    })
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
        MobileMessagingWorker {
            state: Arc::new((
                Mutex::new(WorkerState {
                    phase: MessagingWorkerPhase::Running,
                    cycle_running: false,
                    wake_pending: false,
                    completed_cycle_id: 4,
                    last_result: None,
                    retry_deadline: None,
                }),
                Condvar::new(),
            )),
            attachment_transfer_control: Arc::new(AttachmentTransferControl::new()),
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
                &[7; 32],
                [8; 32],
                "token-1".to_string(),
                discard_events(),
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
                &[7; 32],
                [8; 32],
                "token-2".to_string(),
                discard_events(),
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
                &[7; 32],
                [8; 32],
                "token-3".to_string(),
                discard_events(),
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
                &[9; 32],
                [10; 32],
                "token-4".to_string(),
                discard_events(),
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
            &key,
            [12; 32],
            "token-1".to_string(),
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
            &key,
            [12; 32],
            "token-2".to_string(),
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
