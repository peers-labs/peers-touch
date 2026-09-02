use super::fenced_executor::{CapabilityContract, ExecutionLease, FencedExecutor};
use super::local_executor::LocalCapabilityExecutor;
use super::receipt_ledger::{ReceiptLedger, ToolCallSideEffectCount};
use super::resource_registry::ResourceRegistry;
use super::station_transport::{
    CapabilityNegativeControl, CapabilityNegativeControlStationFact, CapabilityStationTransport,
};
use crate::domain::identity::ActiveSession;
use crate::model::agent::{
    CapabilityConstraints, CapabilityPermissionState, ClientCapability,
    ClientCapabilityAdvertisement, ClientCapabilityLease, ClientCapabilityLeaseRevokeReason,
    ClientPlatform,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestedCapabilityNegativeControl {
    Unsupported,
    Unauthorized,
    SignatureTamper,
    SchemaMismatch,
    CrossDevice,
}

impl RequestedCapabilityNegativeControl {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unsupported => "unsupported",
            Self::Unauthorized => "unauthorized",
            Self::SignatureTamper => "signatureTamper",
            Self::SchemaMismatch => "schemaMismatch",
            Self::CrossDevice => "crossDevice",
        }
    }

    fn station_control(self) -> Option<CapabilityNegativeControl> {
        match self {
            Self::Unauthorized => Some(CapabilityNegativeControl::Unauthorized),
            Self::SignatureTamper => Some(CapabilityNegativeControl::SignatureTamper),
            Self::CrossDevice => Some(CapabilityNegativeControl::CrossDevice),
            Self::Unsupported | Self::SchemaMismatch => None,
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
pub struct CapabilityNegativeControlFacts {
    pub control: &'static str,
    pub availability: &'static str,
    pub unavailable_reason: Option<&'static str>,
    pub capability_session_id_hash: String,
    pub before: CapabilityExecutionCounters,
    pub station: Option<CapabilityNegativeControlStationFact>,
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
            .recv_timeout(NEGATIVE_CONTROL_TIMEOUT)
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

struct ActiveWorker {
    context: WorkerContext,
    lease: ClientCapabilityLease,
    ledger: Option<ReceiptLedger>,
    resources: Option<ResourceRegistry>,
    executor: Option<LocalCapabilityExecutor>,
    pull_cursor: u64,
    surface: ClientSurface,
}

impl ActiveWorker {
    fn register(context: WorkerContext, surface: ClientSurface) -> Result<Self, String> {
        let contracts = local_contracts(surface);
        let (executor, ledger, resources) = if surface == ClientSurface::Desktop {
            let executor = LocalCapabilityExecutor::new(contracts.clone())?;
            let ledger = ReceiptLedger::open(&context.actor_ptid, &context.device_id)?;
            let resources = ResourceRegistry::open(&context.actor_ptid, &context.device_id)?;
            recover_persisted_receipts(&context, &ledger, &resources, &executor)?;
            (Some(executor), Some(ledger), Some(resources))
        } else {
            (None, None, None)
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
            context,
            lease,
            executor,
            pull_cursor: 0,
            surface,
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
        if lease_expiry_ms(&self.lease)? <= now_ms {
            return Err("CLIENT_CAPABILITY_LEASE_EXPIRED".to_string());
        }
        if lease_expiry_ms(&self.lease)? - now_ms <= RENEW_BEFORE_EXPIRY_MS {
            self.renew()?;
        }
        if self.surface == ClientSurface::Browser {
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
        process_negative_controls(&negative_controls, &workers);
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
    workers: &HashMap<String, ActiveWorker>,
) {
    loop {
        let request = match queue.lock() {
            Ok(mut queue) => queue.pop_front(),
            Err(_) => return,
        };
        let Some(request) = request else {
            return;
        };
        let result = emit_negative_control_from_worker(workers, &request);
        let _ = request.response.send(result);
    }
}

fn emit_negative_control_from_worker(
    workers: &HashMap<String, ActiveWorker>,
    request: &CapabilityNegativeControlRequest,
) -> Result<CapabilityNegativeControlFacts, String> {
    let mut matches = workers.values().filter(|worker| {
        hash_identifier(&worker.lease.capability_session_id) == request.capability_session_id_hash
    });
    let worker = matches
        .next()
        .ok_or_else(|| "AS_F10_CAPABILITY_SESSION_NOT_FOUND".to_string())?;
    if matches.next().is_some() {
        return Err("AS_F10_CAPABILITY_SESSION_AMBIGUOUS".to_string());
    }
    let before = execution_counters(worker)?;
    let Some(station_control) = request.control.station_control() else {
        return Ok(CapabilityNegativeControlFacts {
            control: request.control.as_str(),
            availability: "unavailable",
            unavailable_reason: Some("NO_PRODUCTION_CAPABILITY_ENDPOINT"),
            capability_session_id_hash: request.capability_session_id_hash.clone(),
            before: before.clone(),
            station: None,
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
        before,
        station: Some(station),
        after: execution_counters(worker)?,
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
        if identity_changed {
            stop_worker(
                workers,
                &account_id,
                ClientCapabilityLeaseRevokeReason::StationSwitch,
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

fn local_contracts(surface: ClientSurface) -> Vec<CapabilityContract> {
    if surface == ClientSurface::Browser {
        return Vec::new();
    }
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
        schema_version: "1".to_string(),
        max_argument_bytes: MAX_ARGUMENT_BYTES,
        max_result_bytes: MAX_RESULT_BYTES as usize,
        supports_external_idempotency: false,
    })
    .collect()
}

fn resource_kinds(capability_id: &str) -> Vec<String> {
    match capability_id {
        "filesystem.read" | "filesystem.list" | "shell.execute" | "mcp.invoke" => {
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
        let contracts = local_contracts(ClientSurface::Desktop);
        assert!(contracts
            .iter()
            .all(|contract| !contract.supports_external_idempotency));
        assert_eq!(contracts.len(), 6);
    }

    #[test]
    fn browser_surface_advertises_no_desktop_execution_capabilities() {
        let contracts = local_contracts(ClientSurface::Browser);
        assert!(contracts.is_empty());
        assert_eq!(ClientSurface::Browser.platform(), ClientPlatform::Browser);
        assert_eq!(ClientSurface::Browser.connection_prefix(), "browser");
    }

    #[test]
    fn browser_surface_requires_explicit_lifecycle_start() {
        assert!(!ClientSurface::Browser.starts_automatically());
        assert!(ClientSurface::Desktop.starts_automatically());
    }
}
