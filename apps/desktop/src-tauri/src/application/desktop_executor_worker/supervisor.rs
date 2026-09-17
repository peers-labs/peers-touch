use super::fenced_executor::{CapabilityContract, ExecutionLease, FencedExecutor};
use super::local_executor::LocalCapabilityExecutor;
use super::mcp_operation_executor::McpLifecycleExecutor;
use super::operation_ledger::OperationLedger;
use super::operation_worker::CapabilityOperationWorker;
use super::receipt_ledger::{ReceiptLedger, ToolCallSideEffectCount};
use super::resource_registry::ResourceRegistry;
use super::station_transport::{
    CapabilityNegativeControl, CapabilityNegativeControlStationFact, CapabilityStationTransport,
};
use crate::application::oauth2;
use crate::domain::identity::ActiveSession;
use crate::model::agent::{
    CapabilityConstraints, CapabilityPermissionState, ClientCapability,
    ClientCapabilityAdvertisement, ClientCapabilityLease, ClientCapabilityLeaseRevokeReason,
    ClientPlatform, TakeOverCapabilityCleanupRequest, TakeOverCapabilityCleanupResponse,
    TakeOverCapabilityOperationRequest, TakeOverCapabilityOperationResponse,
};
use crate::state::AppState;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const PULL_LIMIT: u32 = 32;
const RENEW_BEFORE_EXPIRY_MS: i64 = 60_000;
const MAX_ARGUMENT_BYTES: usize = 64 * 1024;
const MAX_RESULT_BYTES: u64 = 256 * 1024;
const NEGATIVE_CONTROL_TIMEOUT: Duration = Duration::from_secs(30);
const LEASE_EXPIRED_NEGATIVE_CONTROL_TIMEOUT: Duration = Duration::from_secs(6 * 60);
const LEASE_EXPIRY_SETTLE_DELAY_MS: i64 = 250;

pub struct CapabilityWorkerSupervisor {
    state: Arc<AppState>,
    surface: ClientSurface,
    stopping: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
    snapshot: Arc<Mutex<Vec<CapabilityWorkerSnapshot>>>,
    negative_controls: Arc<Mutex<VecDeque<CapabilityNegativeControlRequest>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClientSurface {
    Desktop,
    Browser,
}

impl ClientSurface {
    fn from_environment() -> Self {
        match std::env::var("PT_CLIENT_SURFACE")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "browser" => Self::Browser,
            _ => Self::Desktop,
        }
    }

    fn platform(self) -> ClientPlatform {
        match self {
            Self::Desktop => ClientPlatform::Desktop,
            Self::Browser => ClientPlatform::Browser,
        }
    }

    fn connection_prefix(self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Browser => "browser",
        }
    }

    fn starts_automatically(self) -> bool {
        self == Self::Desktop
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityWorkerSnapshot {
    pub actor_ptid: String,
    pub device_id: String,
    pub capability_session_id: String,
    pub lease_id: String,
    pub lease_revision: u64,
    pub capability_set_hash: String,
    pub platform: i32,
    pub capability_ids: Vec<String>,
    pub local_execution_attempt_count: u64,
    pub local_side_effect_count: u64,
    pub tool_call_side_effect_counts: Vec<ToolCallSideEffectCount>,
    pub expires_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityOperationTarget {
    pub device_id: String,
    pub capability_session_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestedCapabilityNegativeControl {
    Unsupported,
    Unauthorized,
    SignatureTamper,
    SchemaMismatch,
    CrossDevice,
    LeasePause,
    LeaseExpired,
}

impl RequestedCapabilityNegativeControl {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unsupported => "unsupported",
            Self::Unauthorized => "unauthorized",
            Self::SignatureTamper => "signatureTamper",
            Self::SchemaMismatch => "schemaMismatch",
            Self::CrossDevice => "crossDevice",
            Self::LeasePause => "leasePause",
            Self::LeaseExpired => "leaseExpired",
        }
    }

    pub fn requires_lease_lifecycle_control(self) -> bool {
        matches!(self, Self::LeasePause | Self::LeaseExpired)
    }

    fn receive_timeout(self) -> Duration {
        match self {
            Self::LeaseExpired => LEASE_EXPIRED_NEGATIVE_CONTROL_TIMEOUT,
            _ => NEGATIVE_CONTROL_TIMEOUT,
        }
    }

    fn station_control(self) -> Option<CapabilityNegativeControl> {
        match self {
            Self::Unauthorized => Some(CapabilityNegativeControl::Unauthorized),
            Self::SignatureTamper => Some(CapabilityNegativeControl::SignatureTamper),
            Self::CrossDevice => Some(CapabilityNegativeControl::CrossDevice),
            Self::Unsupported | Self::SchemaMismatch | Self::LeasePause | Self::LeaseExpired => {
                None
            }
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityExecutionCounters {
    pub local_execution_attempt_count: u64,
    pub local_side_effect_count: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityLeaseTransitionFacts {
    pub source_capability_session_id_hash: String,
    pub source_lease_id_hash: String,
    pub source_lease_revision: u64,
    pub source_expires_at_ms: i64,
    pub current_capability_session_id_hash: String,
    pub current_lease_id_hash: String,
    pub current_expires_at_ms: i64,
    pub current_lease_revision: u64,
    pub current_pull_cursor: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityNegativeControlFacts {
    pub control: &'static str,
    pub availability: &'static str,
    pub unavailable_reason: Option<&'static str>,
    pub capability_session_id_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_paused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_expires_at_ms: Option<i64>,
    pub before: CapabilityExecutionCounters,
    pub station: Option<CapabilityNegativeControlStationFact>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_station: Option<CapabilityNegativeControlStationFact>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay_station: Option<CapabilityNegativeControlStationFact>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lease_transition: Option<CapabilityLeaseTransitionFacts>,
    pub after: CapabilityExecutionCounters,
}

struct CapabilityNegativeControlRequest {
    control: RequestedCapabilityNegativeControl,
    capability_session_id_hash: String,
    cross_device_session_id: Option<String>,
    response: mpsc::SyncSender<Result<CapabilityNegativeControlFacts, String>>,
}

impl CapabilityWorkerSupervisor {
    pub fn new(state: Arc<AppState>) -> Self {
        Self {
            state,
            surface: ClientSurface::from_environment(),
            stopping: Arc::new(AtomicBool::new(false)),
            thread: Mutex::new(None),
            snapshot: Arc::new(Mutex::new(Vec::new())),
            negative_controls: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut handle = self
            .thread
            .lock()
            .map_err(|_| "client capability supervisor lock poisoned".to_string())?;
        if handle.is_some() {
            return Ok(());
        }
        self.stopping.store(false, Ordering::SeqCst);
        let state = self.state.clone();
        let stopping = self.stopping.clone();
        let snapshot = self.snapshot.clone();
        let negative_controls = self.negative_controls.clone();
        let surface = self.surface;
        *handle = Some(
            thread::Builder::new()
                .name("client-capability-supervisor".to_string())
                .spawn(move || {
                    run_supervisor(state, surface, stopping, snapshot, negative_controls)
                })
                .map_err(|error| format!("start client capability supervisor: {error}"))?,
        );
        Ok(())
    }

    pub fn starts_automatically(&self) -> bool {
        self.surface.starts_automatically()
    }

    pub fn is_browser_surface(&self) -> bool {
        self.surface == ClientSurface::Browser
    }

    pub fn shutdown(&self) -> Result<(), String> {
        self.stopping.store(true, Ordering::SeqCst);
        let handle = self
            .thread
            .lock()
            .map_err(|_| "client capability supervisor lock poisoned".to_string())?
            .take();
        if let Some(handle) = handle {
            handle
                .join()
                .map_err(|_| "client capability supervisor thread panicked".to_string())?;
        }
        Ok(())
    }

    pub fn snapshot(&self) -> Result<Vec<CapabilityWorkerSnapshot>, String> {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| "client capability supervisor snapshot lock poisoned".to_string())
    }

    pub fn operation_target(&self, actor_ptid: &str) -> Result<CapabilityOperationTarget, String> {
        self.snapshot()?
            .into_iter()
            .filter(|worker| {
                worker.actor_ptid == actor_ptid
                    && worker.platform == ClientPlatform::Desktop as i32
                    && worker.capability_ids.iter().any(|id| id == "mcp.invoke")
            })
            .max_by_key(|worker| worker.expires_at_ms)
            .map(|worker| CapabilityOperationTarget {
                device_id: worker.device_id,
                capability_session_id: worker.capability_session_id,
            })
            .ok_or_else(|| "MCP_CLIENT_CAPABILITY_SESSION_UNAVAILABLE".to_string())
    }

    pub fn take_over_operation(
        &self,
        actor_ptid: &str,
        mut request: TakeOverCapabilityOperationRequest,
    ) -> Result<TakeOverCapabilityOperationResponse, String> {
        let target = self.operation_target(actor_ptid)?;
        request.target_device_id = target.device_id;
        request.capability_session_id = target.capability_session_id;
        let context = self.context_for_actor(actor_ptid)?;
        context.transport()?.take_over_operation(request)
    }

    pub fn take_over_cleanup(
        &self,
        actor_ptid: &str,
        mut request: TakeOverCapabilityCleanupRequest,
    ) -> Result<TakeOverCapabilityCleanupResponse, String> {
        let target = self.operation_target(actor_ptid)?;
        request.target_device_id = target.device_id;
        request.capability_session_id = target.capability_session_id;
        let context = self.context_for_actor(actor_ptid)?;
        context.transport()?.take_over_cleanup(request)
    }

    fn context_for_actor(&self, actor_ptid: &str) -> Result<WorkerContext, String> {
        let session = self
            .state
            .sessions
            .snapshot_all()
            .into_iter()
            .find(|session| session.actor.ptid == actor_ptid)
            .ok_or_else(|| "authenticated actor session is unavailable".to_string())?;
        worker_context(&self.state, session)
    }

    pub fn emit_negative_control(
        &self,
        control: RequestedCapabilityNegativeControl,
        capability_session_id_hash: String,
        cross_device_session_id: Option<String>,
    ) -> Result<CapabilityNegativeControlFacts, String> {
        if capability_session_id_hash.trim().is_empty() {
            return Err("AS_F10_CAPABILITY_SESSION_HASH_REQUIRED".to_string());
        }
        let (response, receiver) = mpsc::sync_channel(1);
        self.negative_controls
            .lock()
            .map_err(|_| "client capability negative-control queue lock poisoned".to_string())?
            .push_back(CapabilityNegativeControlRequest {
                control,
                capability_session_id_hash,
                cross_device_session_id,
                response,
            });
        receiver
            .recv_timeout(control.receive_timeout())
            .map_err(|_| "AS_F10_NEGATIVE_CONTROL_TIMEOUT".to_string())?
    }
}

struct WorkerContext {
    account_id: String,
    station_url: String,
    actor_ptid: String,
    device_id: String,
    token: String,
    signing_key_id: String,
    signing_key: ed25519_dalek::SigningKey,
}

impl WorkerContext {
    fn transport(&self) -> Result<CapabilityStationTransport<'_>, String> {
        CapabilityStationTransport::new(
            &self.station_url,
            &self.actor_ptid,
            &self.device_id,
            &self.token,
            &self.signing_key_id,
            &self.signing_key,
        )
    }
}

struct ActiveWorker {
    context: WorkerContext,
    lease: ClientCapabilityLease,
    ledger: Option<ReceiptLedger>,
    resources: Option<ResourceRegistry>,
    executor: Option<LocalCapabilityExecutor>,
    operation_ledger: Option<OperationLedger>,
    operation_executor: Option<McpLifecycleExecutor>,
    pull_cursor: u64,
    surface: ClientSurface,
    paused: bool,
    connector_projection_epoch: u64,
}

impl ActiveWorker {
    fn register(context: WorkerContext, surface: ClientSurface) -> Result<Self, String> {
        let connector_projection_epoch = oauth2::connector_projection_epoch();
        let contracts = local_contracts(surface, &context.actor_ptid)?;
        let (executor, ledger, resources) = if !contracts.is_empty() {
            let executor = LocalCapabilityExecutor::new(&context.actor_ptid, contracts.clone())?;
            let ledger = ReceiptLedger::open(&context.actor_ptid, &context.device_id)?;
            let resources = ResourceRegistry::open(&context.actor_ptid, &context.device_id)?;
            recover_persisted_receipts(&context, &ledger, &resources, &executor)?;
            (Some(executor), Some(ledger), Some(resources))
        } else {
            (None, None, None)
        };
        let (operation_ledger, operation_executor) = if surface == ClientSurface::Desktop {
            (
                Some(OperationLedger::open(
                    &context.actor_ptid,
                    &context.device_id,
                )?),
                Some(McpLifecycleExecutor::new(&context.actor_ptid)?),
            )
        } else {
            (None, None)
        };
        let transport = CapabilityStationTransport::new(
            &context.station_url,
            &context.actor_ptid,
            &context.device_id,
            &context.token,
            &context.signing_key_id,
            &context.signing_key,
        )?;
        let lease = transport.register(advertisement(&context, &contracts, surface))?;
        ensure_lease_identity(&context, &lease)?;
        Ok(Self {
            ledger,
            resources,
            operation_ledger,
            operation_executor,
            context,
            lease,
            executor,
            pull_cursor: 0,
            surface,
            paused: false,
            connector_projection_epoch,
        })
    }

    fn same_identity(&self, candidate: &WorkerContext) -> bool {
        self.context.account_id == candidate.account_id
            && self.context.station_url == candidate.station_url
            && self.context.actor_ptid == candidate.actor_ptid
            && self.context.device_id == candidate.device_id
            && self.context.signing_key_id == candidate.signing_key_id
            && token_digest(&self.context.token) == token_digest(&candidate.token)
    }

    fn tick(&mut self) -> Result<(), String> {
        let now_ms = now_unix_ms();
        match lease_tick_decision(self.paused, lease_expiry_ms(&self.lease)?, now_ms) {
            LeaseTickDecision::Paused => return Ok(()),
            LeaseTickDecision::Expired => return Err("CLIENT_CAPABILITY_LEASE_EXPIRED".to_string()),
            LeaseTickDecision::Renew => self.renew()?,
            LeaseTickDecision::Pull => {}
        }
        if self.executor.is_none() {
            return Ok(());
        }

        let transport = self.transport()?;
        let ledger = self
            .ledger
            .as_ref()
            .ok_or_else(|| "CLIENT_CAPABILITY_LEDGER_UNAVAILABLE".to_string())?;
        let resources = self
            .resources
            .as_ref()
            .ok_or_else(|| "CLIENT_CAPABILITY_RESOURCE_REGISTRY_UNAVAILABLE".to_string())?;
        let executor = self
            .executor
            .as_ref()
            .ok_or_else(|| "CLIENT_CAPABILITY_EXECUTOR_UNAVAILABLE".to_string())?;
        if let (Some(operation_ledger), Some(operation_executor)) = (
            self.operation_ledger.as_ref(),
            self.operation_executor.as_ref(),
        ) {
            CapabilityOperationWorker::new(
                &self.context.station_url,
                &self.context.device_id,
                &self.lease.capability_session_id,
                operation_ledger,
                operation_executor,
                &transport,
            )
            .tick_at(now_ms)?;
        }
        let response = transport.pull(
            &self.lease.capability_session_id,
            self.pull_cursor,
            PULL_LIMIT,
        )?;
        let response_last_sequence = response.last_sequence;
        let had_requests = !response.requests.is_empty();
        let mut previous = self.pull_cursor;
        for envelope in response.requests {
            if envelope.dispatch_sequence <= previous {
                return Err("CLIENT_CAPABILITY_PULL_SEQUENCE_REGRESSION".to_string());
            }
            let consumed_sequence = envelope.dispatch_sequence;
            let execution_lease = execution_lease(&self.context, &self.lease)?;
            let fenced = FencedExecutor::new(
                &execution_lease,
                ledger,
                resources,
                &self.context.signing_key_id,
                &self.context.signing_key,
                executor,
                &transport,
            );
            fenced.consume(envelope)?;
            previous = advance_pull_cursor(previous, consumed_sequence, response_last_sequence)?;
        }
        self.pull_cursor = finalize_pull_cursor(previous, response_last_sequence, had_requests)?;
        Ok(())
    }

    fn renew(&mut self) -> Result<(), String> {
        let renewed = self.transport()?.renew(&self.lease)?;
        if renewed.capability_session_id != self.lease.capability_session_id
            || renewed.lease_id != self.lease.lease_id
            || renewed.lease_revision <= self.lease.lease_revision
            || renewed.capability_set_hash != self.lease.capability_set_hash
            || renewed.device_signing_key_id != self.lease.device_signing_key_id
        {
            return Err("CLIENT_CAPABILITY_RENEW_RESPONSE_MISMATCH".to_string());
        }
        self.lease = renewed;
        Ok(())
    }

    fn revoke(&mut self, reason: ClientCapabilityLeaseRevokeReason) -> Result<(), String> {
        self.transport()?.revoke(&self.lease, reason)?;
        Ok(())
    }

    fn transport(&self) -> Result<CapabilityStationTransport<'_>, String> {
        CapabilityStationTransport::new(
            &self.context.station_url,
            &self.context.actor_ptid,
            &self.context.device_id,
            &self.context.token,
            &self.context.signing_key_id,
            &self.context.signing_key,
        )
    }
}

fn run_supervisor(
    state: Arc<AppState>,
    surface: ClientSurface,
    stopping: Arc<AtomicBool>,
    snapshot: Arc<Mutex<Vec<CapabilityWorkerSnapshot>>>,
    negative_controls: Arc<Mutex<VecDeque<CapabilityNegativeControlRequest>>>,
) {
    let mut workers = HashMap::<String, ActiveWorker>::new();
    let mut enrollment_backoff: HashMap<String, std::time::Instant> = HashMap::new();
    while !stopping.load(Ordering::SeqCst) {
        reconcile_workers(&state, surface, &mut workers, &mut enrollment_backoff);
        process_negative_controls(&negative_controls, &mut workers);
        let mut replace_accounts = Vec::new();
        for worker in workers.values_mut() {
            if let Err(error) = worker.tick() {
                tracing::warn!(
                    actor = %worker.context.actor_ptid,
                    device = %worker.context.device_id,
                    error = %error,
                    "client capability worker tick failed"
                );
                if requires_worker_replacement(&error) {
                    replace_accounts.push(worker.context.account_id.clone());
                }
            }
        }
        for account in replace_accounts {
            workers.remove(&account);
        }
        if let Err(error) = publish_worker_snapshot(&snapshot, &workers) {
            tracing::warn!(
                error = %error,
                "client capability worker snapshot publication failed"
            );
        }
        thread::sleep(POLL_INTERVAL);
    }
    stop_all(
        &mut workers,
        ClientCapabilityLeaseRevokeReason::WorkerShutdown,
    );
    if let Err(error) = publish_worker_snapshot(&snapshot, &workers) {
        tracing::warn!(
            error = %error,
            "final client capability worker snapshot publication failed"
        );
    }
}

fn process_negative_controls(
    queue: &Mutex<VecDeque<CapabilityNegativeControlRequest>>,
    workers: &mut HashMap<String, ActiveWorker>,
) {
    let pending_count = queue
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .len();
    for _ in 0..pending_count {
        let request = queue
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pop_front();
        let Some(request) = request else {
            return;
        };
        if request.control == RequestedCapabilityNegativeControl::LeaseExpired {
            match lease_expired_control_ready(workers, &request) {
                Ok(false) => {
                    queue
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push_back(request);
                    continue;
                }
                Ok(true) => {}
                Err(error) => {
                    unpause_matching_worker(workers, &request.capability_session_id_hash);
                    let _ = request.response.send(Err(error));
                    continue;
                }
            }
        }
        let result = emit_negative_control_from_worker(workers, &request);
        let _ = request.response.send(result);
    }
}

fn emit_negative_control_from_worker(
    workers: &mut HashMap<String, ActiveWorker>,
    request: &CapabilityNegativeControlRequest,
) -> Result<CapabilityNegativeControlFacts, String> {
    let account_id = matching_worker_account_id(workers, &request.capability_session_id_hash)?;
    let worker = workers
        .get_mut(&account_id)
        .ok_or_else(|| "AS_F10_CAPABILITY_SESSION_NOT_FOUND".to_string())?;
    if request.control == RequestedCapabilityNegativeControl::LeasePause {
        let before = execution_counters(worker)?;
        let source_expires_at_ms = lease_expiry_ms(&worker.lease)?;
        worker.paused = true;
        return Ok(CapabilityNegativeControlFacts {
            control: request.control.as_str(),
            availability: "available",
            unavailable_reason: None,
            capability_session_id_hash: request.capability_session_id_hash.clone(),
            worker_paused: Some(true),
            source_expires_at_ms: Some(source_expires_at_ms),
            before: before.clone(),
            station: None,
            source_station: None,
            replay_station: None,
            lease_transition: None,
            after: before,
        });
    }
    if request.control == RequestedCapabilityNegativeControl::LeaseExpired {
        return emit_lease_expired_control_from_worker(worker, request);
    }

    let before = execution_counters(worker)?;
    let Some(station_control) = request.control.station_control() else {
        return Ok(CapabilityNegativeControlFacts {
            control: request.control.as_str(),
            availability: "unavailable",
            unavailable_reason: Some("NO_PRODUCTION_CAPABILITY_ENDPOINT"),
            capability_session_id_hash: request.capability_session_id_hash.clone(),
            worker_paused: None,
            source_expires_at_ms: None,
            before: before.clone(),
            station: None,
            source_station: None,
            replay_station: None,
            lease_transition: None,
            after: before,
        });
    };
    let station = worker.transport()?.emit_negative_control(
        station_control,
        &worker.lease.capability_session_id,
        request.cross_device_session_id.as_deref(),
    )?;
    Ok(CapabilityNegativeControlFacts {
        control: station_control.as_str(),
        availability: "available",
        unavailable_reason: None,
        capability_session_id_hash: request.capability_session_id_hash.clone(),
        worker_paused: None,
        source_expires_at_ms: None,
        before,
        station: Some(station),
        source_station: None,
        replay_station: None,
        lease_transition: None,
        after: execution_counters(worker)?,
    })
}

fn matching_worker_account_id(
    workers: &HashMap<String, ActiveWorker>,
    capability_session_id_hash: &str,
) -> Result<String, String> {
    let mut matches = workers.iter().filter(|(_, worker)| {
        hash_identifier(&worker.lease.capability_session_id) == capability_session_id_hash
    });
    let account_id = matches
        .next()
        .map(|(account_id, _)| account_id.clone())
        .ok_or_else(|| "AS_F10_CAPABILITY_SESSION_NOT_FOUND".to_string())?;
    if matches.next().is_some() {
        return Err("AS_F10_CAPABILITY_SESSION_AMBIGUOUS".to_string());
    }
    Ok(account_id)
}

fn unpause_matching_worker(
    workers: &mut HashMap<String, ActiveWorker>,
    capability_session_id_hash: &str,
) {
    if let Ok(account_id) = matching_worker_account_id(workers, capability_session_id_hash) {
        if let Some(worker) = workers.get_mut(&account_id) {
            worker.paused = false;
        }
    }
}

fn lease_expired_control_ready(
    workers: &HashMap<String, ActiveWorker>,
    request: &CapabilityNegativeControlRequest,
) -> Result<bool, String> {
    let account_id = matching_worker_account_id(workers, &request.capability_session_id_hash)?;
    let worker = workers
        .get(&account_id)
        .ok_or_else(|| "AS_F10_CAPABILITY_SESSION_NOT_FOUND".to_string())?;
    if !worker.paused {
        return Err("GFE1_LEASE_EXPIRED_REQUIRES_PAUSED_WORKER".to_string());
    }
    Ok(lease_expiry_control_ready(
        lease_expiry_ms(&worker.lease)?,
        now_unix_ms(),
    ))
}

fn emit_lease_expired_control_from_worker(
    worker: &mut ActiveWorker,
    request: &CapabilityNegativeControlRequest,
) -> Result<CapabilityNegativeControlFacts, String> {
    let result = (|| {
        if !worker.paused {
            return Err("GFE1_LEASE_EXPIRED_REQUIRES_PAUSED_WORKER".to_string());
        }
        let before = execution_counters(worker)?;
        let source_lease = worker.lease.clone();
        let source_pull_cursor = worker.pull_cursor;
        let source_expires_at_ms = lease_expiry_ms(&source_lease)?;
        if !lease_expiry_control_ready(source_expires_at_ms, now_unix_ms()) {
            return Err("GFE1_LEASE_EXPIRY_NOT_REACHED".to_string());
        }

        let contracts = local_contracts(worker.surface, &worker.context.actor_ptid)?;
        let replacement = {
            let transport = worker.transport()?;
            transport.register(advertisement(&worker.context, &contracts, worker.surface))?
        };
        ensure_lease_identity(&worker.context, &replacement)?;
        ensure_replacement_lease(&source_lease, &replacement, now_unix_ms())?;

        worker.lease = replacement;
        worker.pull_cursor = 0;

        let (source_station, replay_station) = worker.transport()?.emit_expired_lease_pull_replay(
            &source_lease.capability_session_id,
            source_pull_cursor,
            PULL_LIMIT,
        )?;
        let lease_transition =
            lease_transition_facts(&source_lease, &worker.lease, worker.pull_cursor)?;
        Ok(CapabilityNegativeControlFacts {
            control: request.control.as_str(),
            availability: "available",
            unavailable_reason: None,
            capability_session_id_hash: request.capability_session_id_hash.clone(),
            worker_paused: Some(false),
            source_expires_at_ms: Some(source_expires_at_ms),
            before: before.clone(),
            station: Some(source_station.clone()),
            source_station: Some(source_station),
            replay_station: Some(replay_station),
            lease_transition: Some(lease_transition),
            after: before,
        })
    })();

    worker.paused = false;
    result.and_then(|mut facts| {
        facts.after = execution_counters(worker)?;
        Ok(facts)
    })
}

fn ensure_replacement_lease(
    source: &ClientCapabilityLease,
    replacement: &ClientCapabilityLease,
    now_ms: i64,
) -> Result<(), String> {
    if replacement.capability_session_id == source.capability_session_id
        || replacement.lease_id == source.lease_id
        || replacement.capability_set_hash != source.capability_set_hash
        || replacement.device_signing_key_id != source.device_signing_key_id
        || replacement.platform != source.platform
        || lease_expiry_ms(replacement)? <= now_ms
    {
        return Err("GFE1_REPLACEMENT_LEASE_MISMATCH".to_string());
    }
    Ok(())
}

fn lease_transition_facts(
    source: &ClientCapabilityLease,
    current: &ClientCapabilityLease,
    current_pull_cursor: u64,
) -> Result<CapabilityLeaseTransitionFacts, String> {
    Ok(CapabilityLeaseTransitionFacts {
        source_capability_session_id_hash: hash_identifier(&source.capability_session_id),
        source_lease_id_hash: hash_identifier(&source.lease_id),
        source_lease_revision: source.lease_revision,
        source_expires_at_ms: lease_expiry_ms(source)?,
        current_capability_session_id_hash: hash_identifier(&current.capability_session_id),
        current_lease_id_hash: hash_identifier(&current.lease_id),
        current_expires_at_ms: lease_expiry_ms(current)?,
        current_lease_revision: current.lease_revision,
        current_pull_cursor,
    })
}

fn execution_counters(worker: &ActiveWorker) -> Result<CapabilityExecutionCounters, String> {
    let side_effect_counts = tool_call_side_effect_counts(worker)?;
    Ok(CapabilityExecutionCounters {
        local_execution_attempt_count: worker
            .executor
            .as_ref()
            .map(LocalCapabilityExecutor::execution_attempt_count)
            .unwrap_or_default(),
        local_side_effect_count: side_effect_counts
            .iter()
            .map(|count| count.side_effect_count)
            .sum(),
    })
}

fn tool_call_side_effect_counts(
    worker: &ActiveWorker,
) -> Result<Vec<ToolCallSideEffectCount>, String> {
    worker
        .ledger
        .as_ref()
        .map(ReceiptLedger::side_effect_counts)
        .transpose()
        .map(Option::unwrap_or_default)
}

fn hash_identifier(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn publish_worker_snapshot(
    target: &Mutex<Vec<CapabilityWorkerSnapshot>>,
    workers: &HashMap<String, ActiveWorker>,
) -> Result<(), String> {
    let mut next = workers
        .values()
        .map(|worker| {
            let tool_call_side_effect_counts = tool_call_side_effect_counts(worker)?;
            let local_side_effect_count = tool_call_side_effect_counts
                .iter()
                .map(|count| count.side_effect_count)
                .sum();
            Ok(CapabilityWorkerSnapshot {
                actor_ptid: worker.context.actor_ptid.clone(),
                device_id: worker.context.device_id.clone(),
                capability_session_id: worker.lease.capability_session_id.clone(),
                lease_id: worker.lease.lease_id.clone(),
                lease_revision: worker.lease.lease_revision,
                capability_set_hash: worker.lease.capability_set_hash.clone(),
                platform: worker.lease.platform,
                capability_ids: worker
                    .lease
                    .capabilities
                    .iter()
                    .map(|capability| capability.capability_id.clone())
                    .collect(),
                local_execution_attempt_count: worker
                    .executor
                    .as_ref()
                    .map(LocalCapabilityExecutor::execution_attempt_count)
                    .unwrap_or_default(),
                local_side_effect_count,
                tool_call_side_effect_counts,
                expires_at_ms: worker
                    .lease
                    .expires_at
                    .as_ref()
                    .map(|timestamp| {
                        timestamp.seconds.saturating_mul(1_000)
                            + i64::from(timestamp.nanos).div_euclid(1_000_000)
                    })
                    .unwrap_or_default(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    next.sort_by(|left, right| left.capability_session_id.cmp(&right.capability_session_id));
    let mut current = target
        .lock()
        .map_err(|_| "client capability worker snapshot lock poisoned".to_string())?;
    *current = next;
    Ok(())
}

const KEY_NOT_FOUND_BACKOFF: Duration = Duration::from_secs(5);

fn reconcile_workers(
    state: &AppState,
    surface: ClientSurface,
    workers: &mut HashMap<String, ActiveWorker>,
    enrollment_backoff: &mut HashMap<String, std::time::Instant>,
) {
    let mut desired = HashMap::new();
    let all_sessions = state.sessions.snapshot_all();
    if all_sessions.is_empty() {
        tracing::info!("capability supervisor: no window sessions registered");
    }
    for session in all_sessions {
        match worker_context(state, session) {
            Ok(context) => {
                desired.insert(context.account_id.clone(), context);
            }
            Err(error) => tracing::warn!(
                error = %error,
                "client capability session is not ready for registration"
            ),
        }
    }

    let desired_accounts = desired.keys().cloned().collect::<HashSet<_>>();
    let stale_accounts = workers
        .keys()
        .filter(|account| !desired_accounts.contains(*account))
        .cloned()
        .collect::<Vec<_>>();
    for account in stale_accounts {
        stop_worker(
            workers,
            &account,
            ClientCapabilityLeaseRevokeReason::UserLogout,
        );
    }

    for (account_id, context) in desired {
        let identity_changed = workers
            .get(&account_id)
            .is_some_and(|worker| !worker.same_identity(&context));
        let connector_projection_changed = workers.get(&account_id).is_some_and(|worker| {
            connector_projection_changed(
                worker.connector_projection_epoch,
                oauth2::connector_projection_epoch(),
            )
        });
        if identity_changed || connector_projection_changed {
            stop_worker(
                workers,
                &account_id,
                if identity_changed {
                    ClientCapabilityLeaseRevokeReason::StationSwitch
                } else {
                    ClientCapabilityLeaseRevokeReason::AdminPolicy
                },
            );
            enrollment_backoff.remove(&account_id);
        }
        if workers.contains_key(&account_id) {
            continue;
        }
        if let Some(cooldown_until) = enrollment_backoff.get(&account_id) {
            if cooldown_until.elapsed() < KEY_NOT_FOUND_BACKOFF {
                continue;
            }
            enrollment_backoff.remove(&account_id);
        }
        match ActiveWorker::register(context, surface) {
            Ok(worker) => {
                workers.insert(account_id, worker);
            }
            Err(error) => {
                if error.contains("command error 2") {
                    tracing::info!(
                        account = %account_id,
                        "capability lease blocked by pending device enrollment, backing off"
                    );
                    enrollment_backoff.insert(account_id, std::time::Instant::now());
                } else {
                    tracing::warn!(
                        account = %account_id,
                        error = %error,
                        "client capability lease registration failed"
                    );
                }
            }
        }
    }
}

fn connector_projection_changed(registered_epoch: u64, current_epoch: u64) -> bool {
    registered_epoch != current_epoch
}

fn stop_worker(
    workers: &mut HashMap<String, ActiveWorker>,
    account_id: &str,
    reason: ClientCapabilityLeaseRevokeReason,
) {
    if let Some(mut worker) = workers.remove(account_id) {
        if let Err(error) = worker.revoke(reason) {
            tracing::warn!(
                actor = %worker.context.actor_ptid,
                device = %worker.context.device_id,
                error = %error,
                "client capability lease revoke failed; Station expiry remains authoritative"
            );
        }
    }
}

fn stop_all(
    workers: &mut HashMap<String, ActiveWorker>,
    reason: ClientCapabilityLeaseRevokeReason,
) {
    let accounts = workers.keys().cloned().collect::<Vec<_>>();
    for account in accounts {
        stop_worker(workers, &account, reason);
    }
}

fn worker_context(state: &AppState, session: ActiveSession) -> Result<WorkerContext, String> {
    if session.account_id.trim().is_empty()
        || session.jwt.trim().is_empty()
        || !session.actor.ptid.starts_with("ptid:")
    {
        return Err(
            "DESIGN_AMENDMENT_REQUIRED: active session has no canonical actor binding".to_string(),
        );
    }
    let engine = state
        .messaging_engines
        .get(&session.account_id)?
        .ok_or_else(|| {
            let keys = state.messaging_engines.profile_ids().unwrap_or_default();
            format!(
                "DESIGN_AMENDMENT_REQUIRED: active session has no actor-device engine \
                 (session.account_id={:?}, engines={:?})",
                session.account_id, keys
            )
        })?;
    if engine.endpoint().ptid != session.actor.ptid || engine.endpoint().device_id.trim().is_empty()
    {
        return Err(
            "DESIGN_AMENDMENT_REQUIRED: session and actor-device endpoint disagree".to_string(),
        );
    }
    let (signing_key_id, signing_key) = engine
        .device_signing_identity()?
        .ok_or_else(|| "device signing identity not yet enrolled".to_string())?;
    Ok(WorkerContext {
        account_id: session.account_id,
        station_url: crate::infrastructure::station_client::station_base_url(),
        actor_ptid: session.actor.ptid,
        device_id: engine.endpoint().device_id.clone(),
        token: session.jwt,
        signing_key_id,
        signing_key,
    })
}

fn advertisement(
    context: &WorkerContext,
    contracts: &[CapabilityContract],
    surface: ClientSurface,
) -> ClientCapabilityAdvertisement {
    ClientCapabilityAdvertisement {
        advertisement_id: format!("capability_advertisement_{}", ulid::Ulid::new()),
        platform: surface.platform() as i32,
        capabilities: contracts
            .iter()
            .map(|contract| ClientCapability {
                capability_id: contract.capability_id.clone(),
                schema_version: contract.schema_version.clone(),
                permission: CapabilityPermissionState::Granted as i32,
                constraints: Some(CapabilityConstraints {
                    max_request_bytes: contract.max_argument_bytes as u64,
                    max_result_bytes: contract.max_result_bytes as u64,
                    allowed_resource_kinds: resource_kinds(&contract.capability_id),
                }),
            })
            .collect(),
        connection_id: format!(
            "{}:{}:{}",
            surface.connection_prefix(),
            std::process::id(),
            context.device_id
        ),
        device_signing_key_id: context.signing_key_id.clone(),
        device_id: context.device_id.clone(),
    }
}

fn local_contracts(
    surface: ClientSurface,
    actor_ptid: &str,
) -> Result<Vec<CapabilityContract>, String> {
    let mut contracts = Vec::new();
    if surface == ClientSurface::Desktop {
        contracts.extend(
            [
                "filesystem.read",
                "filesystem.list",
                "clipboard.read",
                "clipboard.write",
                "shell.execute",
                "mcp.invoke",
            ]
            .into_iter()
            .map(|capability_id| CapabilityContract {
                capability_id: capability_id.to_string(),
                schema_version: if capability_id == "mcp.invoke" {
                    "2".to_string()
                } else {
                    "1".to_string()
                },
                max_argument_bytes: MAX_ARGUMENT_BYTES,
                max_result_bytes: MAX_RESULT_BYTES as usize,
                supports_external_idempotency: false,
            }),
        );
    }
    contracts.extend(
        oauth2::connector_capability_contracts(actor_ptid)?
            .into_iter()
            .map(|(capability_id, schema_version)| CapabilityContract {
                capability_id,
                schema_version,
                max_argument_bytes: MAX_ARGUMENT_BYTES,
                max_result_bytes: MAX_RESULT_BYTES as usize,
                supports_external_idempotency: false,
            }),
    );
    contracts.sort_by(|left, right| {
        left.capability_id
            .cmp(&right.capability_id)
            .then_with(|| left.schema_version.cmp(&right.schema_version))
    });
    Ok(contracts)
}

fn resource_kinds(capability_id: &str) -> Vec<String> {
    match capability_id {
        "filesystem.read" | "filesystem.list" | "shell.execute" => {
            vec!["workspace".to_string()]
        }
        _ => Vec::new(),
    }
}

fn ensure_lease_identity(
    context: &WorkerContext,
    lease: &ClientCapabilityLease,
) -> Result<(), String> {
    if lease.ptid != context.actor_ptid
        || lease.device_id != context.device_id
        || lease.device_signing_key_id != context.signing_key_id
    {
        return Err("CLIENT_CAPABILITY_LEASE_IDENTITY_MISMATCH".to_string());
    }
    Ok(())
}

fn execution_lease(
    context: &WorkerContext,
    lease: &ClientCapabilityLease,
) -> Result<ExecutionLease, String> {
    ensure_lease_identity(context, lease)?;
    Ok(ExecutionLease {
        station_url: context.station_url.clone(),
        actor_ptid: context.actor_ptid.clone(),
        device_id: context.device_id.clone(),
        capability_session_id: lease.capability_session_id.clone(),
        executor_lease_id: lease.lease_id.clone(),
        lease_revision: lease.lease_revision,
        expires_at_ms: lease_expiry_ms(lease)?,
        revoked: false,
    })
}

fn recover_persisted_receipts(
    context: &WorkerContext,
    ledger: &ReceiptLedger,
    resources: &ResourceRegistry,
    executor: &LocalCapabilityExecutor,
) -> Result<(), String> {
    resources.delete_expired(now_unix_ms())?;
    for record in ledger.list()? {
        if record.station_url.trim().is_empty() {
            tracing::warn!(
                tool_call_id = %record.envelope.tool_call_id,
                "persisted client capability receipt has no Station origin; recovery is unavailable"
            );
            continue;
        }
        let envelope = record.envelope;
        let recovery_lease = ExecutionLease {
            station_url: record.station_url.clone(),
            actor_ptid: context.actor_ptid.clone(),
            device_id: context.device_id.clone(),
            capability_session_id: envelope.capability_session_id.clone(),
            executor_lease_id: envelope.executor_lease_id.clone(),
            lease_revision: envelope.capability_lease_revision,
            expires_at_ms: 0,
            revoked: true,
        };
        let transport = CapabilityStationTransport::new(
            &record.station_url,
            &context.actor_ptid,
            &context.device_id,
            &context.token,
            &context.signing_key_id,
            &context.signing_key,
        )?;
        let fenced = FencedExecutor::new(
            &recovery_lease,
            ledger,
            resources,
            &context.signing_key_id,
            &context.signing_key,
            executor,
            &transport,
        );
        match fenced.consume(envelope) {
            Ok(_) => {}
            Err(error) if error == "CLIENT_CAPABILITY_RECONCILIATION_DEADLINE_EXPIRED" => {}
            Err(error) => {
                tracing::warn!(
                    station = %record.station_url,
                    error = %error,
                    "persisted client capability receipt recovery deferred"
                );
            }
        }
    }
    Ok(())
}

fn lease_expiry_ms(lease: &ClientCapabilityLease) -> Result<i64, String> {
    let value = lease
        .expires_at
        .as_ref()
        .ok_or_else(|| "CLIENT_CAPABILITY_LEASE_EXPIRY_REQUIRED".to_string())?;
    if value.seconds < 0 || !(0..1_000_000_000).contains(&value.nanos) {
        return Err("CLIENT_CAPABILITY_LEASE_EXPIRY_INVALID".to_string());
    }
    value
        .seconds
        .checked_mul(1_000)
        .and_then(|seconds| seconds.checked_add(i64::from(value.nanos) / 1_000_000))
        .ok_or_else(|| "CLIENT_CAPABILITY_LEASE_EXPIRY_INVALID".to_string())
}

fn advance_pull_cursor(
    current: u64,
    consumed_sequence: u64,
    response_last_sequence: u64,
) -> Result<u64, String> {
    if consumed_sequence <= current || consumed_sequence > response_last_sequence {
        return Err("CLIENT_CAPABILITY_PULL_CURSOR_INVALID".to_string());
    }
    Ok(consumed_sequence)
}

fn finalize_pull_cursor(
    consumed_sequence: u64,
    response_last_sequence: u64,
    had_requests: bool,
) -> Result<u64, String> {
    if had_requests && response_last_sequence < consumed_sequence {
        return Err("CLIENT_CAPABILITY_PULL_CURSOR_REGRESSION".to_string());
    }
    Ok(consumed_sequence)
}

fn requires_worker_replacement(error: &str) -> bool {
    error == "CLIENT_CAPABILITY_LEASE_EXPIRED"
        || error == "CLIENT_CAPABILITY_RENEW_RESPONSE_MISMATCH"
        || error.contains("Station rejected capability pull")
        || error.contains("Station rejected capability lease renewal")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LeaseTickDecision {
    Paused,
    Expired,
    Renew,
    Pull,
}

fn lease_tick_decision(paused: bool, expires_at_ms: i64, now_ms: i64) -> LeaseTickDecision {
    if paused {
        LeaseTickDecision::Paused
    } else if expires_at_ms <= now_ms {
        LeaseTickDecision::Expired
    } else if expires_at_ms - now_ms <= RENEW_BEFORE_EXPIRY_MS {
        LeaseTickDecision::Renew
    } else {
        LeaseTickDecision::Pull
    }
}

fn lease_expiry_control_ready(expires_at_ms: i64, now_ms: i64) -> bool {
    now_ms >= expires_at_ms.saturating_add(LEASE_EXPIRY_SETTLE_DELAY_MS)
}

fn token_digest(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_lease(
        capability_session_id: &str,
        lease_id: &str,
        lease_revision: u64,
        expires_at_ms: i64,
    ) -> ClientCapabilityLease {
        ClientCapabilityLease {
            capability_session_id: capability_session_id.to_string(),
            lease_id: lease_id.to_string(),
            lease_revision,
            capability_set_hash: "capability-set".to_string(),
            device_signing_key_id: "signing-key".to_string(),
            platform: ClientPlatform::Browser as i32,
            expires_at: Some(prost_types::Timestamp {
                seconds: expires_at_ms / 1_000,
                nanos: ((expires_at_ms % 1_000) * 1_000_000) as i32,
            }),
            ..ClientCapabilityLease::default()
        }
    }

    #[test]
    fn pull_cursor_never_advances_past_the_station_commit() {
        assert_eq!(advance_pull_cursor(6, 7, 9).unwrap(), 7);
        assert!(advance_pull_cursor(7, 7, 9).is_err());
        assert!(advance_pull_cursor(7, 11, 9).is_err());
        assert_eq!(finalize_pull_cursor(7, 0, false).unwrap(), 7);
        assert!(finalize_pull_cursor(7, 6, true).is_err());
        assert!(requires_worker_replacement(
            "Station rejected capability pull with command error 30001"
        ));
        assert!(!requires_worker_replacement(
            "pull Station client capability requests: request failed"
        ));
    }

    #[test]
    fn local_capability_advertisement_has_no_unimplemented_replay_claim() {
        let contracts = local_contracts(ClientSurface::Desktop, "ptid:person:test").unwrap();
        assert!(contracts
            .iter()
            .all(|contract| !contract.supports_external_idempotency));
        assert_eq!(contracts.len(), 6);
    }

    #[test]
    fn browser_surface_advertises_only_connector_capabilities() {
        let contracts = local_contracts(ClientSurface::Browser, "ptid:person:test").unwrap();
        assert!(contracts.is_empty());
        assert_eq!(ClientSurface::Browser.platform(), ClientPlatform::Browser);
        assert_eq!(ClientSurface::Browser.connection_prefix(), "browser");
    }

    #[test]
    fn browser_surface_requires_explicit_lifecycle_start() {
        assert!(!ClientSurface::Browser.starts_automatically());
        assert!(ClientSurface::Desktop.starts_automatically());
    }

    #[test]
    fn connector_projection_change_replaces_a_stale_capability_lease() {
        assert!(!connector_projection_changed(7, 7));
        assert!(connector_projection_changed(7, 8));
    }

    #[test]
    fn lease_pause_suppresses_pull_renew_and_expiry_replacement() {
        assert_eq!(
            lease_tick_decision(true, 1_000, 2_000),
            LeaseTickDecision::Paused
        );
        assert_eq!(
            lease_tick_decision(false, 1_000, 2_000),
            LeaseTickDecision::Expired
        );
        assert_eq!(
            lease_tick_decision(false, 61_000, 2_000),
            LeaseTickDecision::Renew
        );
        assert_eq!(
            lease_tick_decision(false, 62_001, 2_000),
            LeaseTickDecision::Pull
        );
    }

    #[test]
    fn lease_expired_control_has_a_real_lease_sized_receive_timeout() {
        assert_eq!(
            RequestedCapabilityNegativeControl::LeaseExpired.receive_timeout(),
            Duration::from_secs(6 * 60)
        );
        assert_eq!(
            RequestedCapabilityNegativeControl::LeasePause.receive_timeout(),
            NEGATIVE_CONTROL_TIMEOUT
        );
        assert!(RequestedCapabilityNegativeControl::LeaseExpired.requires_lease_lifecycle_control());
    }

    #[test]
    fn lease_expiry_control_waits_past_the_station_expiry_boundary() {
        assert!(!lease_expiry_control_ready(10_000, 10_249));
        assert!(lease_expiry_control_ready(10_000, 10_250));
    }

    #[test]
    fn lease_transition_exposes_only_hashed_authority_and_reset_cursor() {
        let source = test_lease("source-session", "source-lease", 9, 10_000);
        let current = test_lease("current-session", "current-lease", 1, 20_000);

        ensure_replacement_lease(&source, &current, 15_000).unwrap();
        let facts = lease_transition_facts(&source, &current, 0).unwrap();

        assert_eq!(
            facts.source_capability_session_id_hash,
            hash_identifier("source-session")
        );
        assert_eq!(
            facts.current_capability_session_id_hash,
            hash_identifier("current-session")
        );
        assert_ne!(
            facts.source_capability_session_id_hash,
            facts.current_capability_session_id_hash
        );
        assert_eq!(facts.source_expires_at_ms, 10_000);
        assert_eq!(facts.current_expires_at_ms, 20_000);
        assert_eq!(facts.current_lease_revision, 1);
        assert_eq!(facts.current_pull_cursor, 0);
    }

    #[test]
    fn replacement_lease_must_be_new_current_authority() {
        let source = test_lease("source-session", "source-lease", 9, 10_000);
        let same_session = test_lease("source-session", "current-lease", 1, 20_000);
        let stale = test_lease("current-session", "current-lease", 1, 15_000);

        assert!(ensure_replacement_lease(&source, &same_session, 15_000).is_err());
        assert!(ensure_replacement_lease(&source, &stale, 15_000).is_err());
    }
}
