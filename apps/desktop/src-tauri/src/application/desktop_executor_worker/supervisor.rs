use super::fenced_executor::{CapabilityContract, ExecutionLease, FencedExecutor};
use super::local_executor::LocalCapabilityExecutor;
use super::receipt_ledger::ReceiptLedger;
use super::resource_registry::ResourceRegistry;
use super::station_transport::CapabilityStationTransport;
use crate::domain::actor_device_identity::ActorDeviceIdentity;
use crate::domain::identity::ActiveSession;
use crate::model::agent::{
    CapabilityConstraints, CapabilityPermissionState, ClientCapability,
    ClientCapabilityAdvertisement, ClientCapabilityLease, ClientCapabilityLeaseRevokeReason,
    ClientPlatform,
};
use crate::state::AppState;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const PULL_LIMIT: u32 = 32;
const RENEW_BEFORE_EXPIRY_MS: i64 = 60_000;
const MAX_ARGUMENT_BYTES: usize = 64 * 1024;
const MAX_RESULT_BYTES: u64 = 256 * 1024;

pub struct CapabilityWorkerSupervisor {
    state: Arc<AppState>,
    stopping: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl CapabilityWorkerSupervisor {
    pub fn new(state: Arc<AppState>) -> Self {
        Self {
            state,
            stopping: Arc::new(AtomicBool::new(false)),
            thread: Mutex::new(None),
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
        *handle = Some(
            thread::Builder::new()
                .name("client-capability-supervisor".to_string())
                .spawn(move || run_supervisor(state, stopping))
                .map_err(|error| format!("start client capability supervisor: {error}"))?,
        );
        Ok(())
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
}

struct WorkerContext {
    account_id: String,
    station_url: String,
    actor_ptid: String,
    device_id: String,
    token: String,
    signing_key_id: String,
    identity: Arc<ActorDeviceIdentity>,
}

struct ActiveWorker {
    context: WorkerContext,
    lease: ClientCapabilityLease,
    ledger: ReceiptLedger,
    resources: ResourceRegistry,
    executor: LocalCapabilityExecutor,
    pull_cursor: u64,
}

impl ActiveWorker {
    fn register(context: WorkerContext) -> Result<Self, String> {
        let contracts = local_contracts();
        let executor = LocalCapabilityExecutor::new(contracts.clone())?;
        let ledger = ReceiptLedger::open(&context.actor_ptid, &context.device_id)?;
        let resources = ResourceRegistry::open(&context.actor_ptid, &context.device_id)?;
        recover_persisted_receipts(&context, &ledger, &resources, &executor)?;
        let transport = CapabilityStationTransport::new(
            &context.station_url,
            &context.actor_ptid,
            &context.device_id,
            &context.token,
            context.identity.as_ref(),
        )?;
        let lease = transport.register(advertisement(&context, &contracts))?;
        ensure_lease_identity(&context, &lease)?;
        Ok(Self {
            ledger,
            resources,
            context,
            lease,
            executor,
            pull_cursor: 0,
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

        let transport = self.transport()?;
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
                &self.ledger,
                &self.resources,
                self.context.identity.as_ref(),
                &self.executor,
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
            self.context.identity.as_ref(),
        )
    }
}

fn run_supervisor(state: Arc<AppState>, stopping: Arc<AtomicBool>) {
    let mut workers = HashMap::<String, ActiveWorker>::new();
    while !stopping.load(Ordering::SeqCst) {
        reconcile_workers(&state, &mut workers);
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
        thread::sleep(POLL_INTERVAL);
    }
    stop_all(
        &mut workers,
        ClientCapabilityLeaseRevokeReason::WorkerShutdown,
    );
}

fn reconcile_workers(state: &AppState, workers: &mut HashMap<String, ActiveWorker>) {
    let mut desired = HashMap::new();
    for session in state.sessions.snapshot_all() {
        match worker_context(state, session) {
            Ok(context) => {
                desired.insert(context.account_id.clone(), context);
            }
            Err(error) => tracing::debug!(
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
        }
        if workers.contains_key(&account_id) {
            continue;
        }
        match ActiveWorker::register(context) {
            Ok(worker) => {
                workers.insert(account_id, worker);
            }
            Err(error) => tracing::warn!(
                account = %account_id,
                error = %error,
                "client capability lease registration failed"
            ),
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
            "DESIGN_AMENDMENT_REQUIRED: active session has no actor-device engine".to_string()
        })?;
    if engine.endpoint().ptid != session.actor.ptid || engine.endpoint().device_id.trim().is_empty()
    {
        return Err(
            "DESIGN_AMENDMENT_REQUIRED: session and actor-device endpoint disagree".to_string(),
        );
    }
    let identity = engine.actor_device_identity();
    let (signing_key_id, _) = identity.signing_identity().map_err(|_| {
        "DESIGN_AMENDMENT_REQUIRED: current actor-device signing identity is unavailable"
            .to_string()
    })?;
    Ok(WorkerContext {
        account_id: session.account_id,
        station_url: crate::infrastructure::station_client::station_base_url(),
        actor_ptid: session.actor.ptid,
        device_id: engine.endpoint().device_id.clone(),
        token: session.jwt,
        signing_key_id,
        identity,
    })
}

fn advertisement(
    context: &WorkerContext,
    contracts: &[CapabilityContract],
) -> ClientCapabilityAdvertisement {
    ClientCapabilityAdvertisement {
        advertisement_id: format!("capability_advertisement_{}", ulid::Ulid::new()),
        platform: ClientPlatform::Desktop as i32,
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
        connection_id: format!("desktop:{}:{}", std::process::id(), context.device_id),
        device_signing_key_id: context.signing_key_id.clone(),
        device_id: context.device_id.clone(),
    }
}

fn local_contracts() -> Vec<CapabilityContract> {
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
            context.identity.as_ref(),
        )?;
        let fenced = FencedExecutor::new(
            &recovery_lease,
            ledger,
            resources,
            context.identity.as_ref(),
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
        let contracts = local_contracts();
        assert!(contracts
            .iter()
            .all(|contract| !contract.supports_external_idempotency));
        assert_eq!(contracts.len(), 6);
    }
}
