use crate::model::agent::ErrorPayload;
use crate::state::AppState;
use std::collections::HashMap;
use std::sync::Arc;

pub(crate) mod fenced_executor;
pub(crate) mod local_executor;
pub(crate) mod operation_executor;
pub(crate) mod operation_ledger;
pub(crate) mod operation_worker;
pub(crate) mod receipt_ledger;
pub(crate) mod recovery_signer;
pub(crate) mod resource_registry;
pub(crate) mod station_transport;
pub(crate) mod supervisor;

pub use supervisor::CapabilityWorkerSupervisor;

#[derive(Clone)]
struct WorkerSession {
    actor_ptid: String,
    token: String,
}

const CANVAS_READINESS_ERROR_CODE: &str = "AGENT_CANVAS_SINGLE_AGENT_NOT_READY";
const CANVAS_READINESS_LOCALE_KEY: &str = "agent.errors.canvasSingleAgentNotReady";
const CANVAS_READINESS_REQUIRED_GATE: &str = "agent-v2-kernel-foundation-e2e";

// The snake_case name is the cross-runtime D11 audit marker.
fn enforce_canvas_single_agent_readiness() -> Result<(), ErrorPayload> {
    Err(ErrorPayload {
        error: CANVAS_READINESS_LOCALE_KEY.to_string(),
        error_type: CANVAS_READINESS_ERROR_CODE.to_string(),
        locale_key: CANVAS_READINESS_LOCALE_KEY.to_string(),
        retryable: false,
        terminal: true,
        details: HashMap::from([(
            "required_gate".to_string(),
            CANVAS_READINESS_REQUIRED_GATE.to_string(),
        )]),
    })
}

fn desktop_executor_worker_enabled(
    product_window_e2e: Option<&str>,
    worker_env: Option<&str>,
) -> bool {
    if let Some(value) = worker_env.map(str::trim).filter(|value| !value.is_empty()) {
        return matches!(value, "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON");
    }
    !matches!(
        product_window_e2e.map(str::trim),
        Some("1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON")
    )
}

fn run_loop(state: Arc<AppState>) {
    loop {
        for session in active_sessions(&state) {
            if let Err(error) = claim_and_execute(&session) {
                tracing::debug!(error = %error, "desktop executor worker tick skipped");
            }
        }
        thread::sleep(WORKER_POLL_INTERVAL);
    }
}

fn active_sessions(state: &AppState) -> Vec<WorkerSession> {
    let mut sessions = Vec::new();
    let mut seen = HashSet::new();
    for session in state.sessions.snapshot_all() {
        push_session(&mut sessions, &mut seen, session.actor.ptid, session.jwt);
    }
    sessions
}

fn push_session(
    sessions: &mut Vec<WorkerSession>,
    seen: &mut HashSet<String>,
    actor_ptid: String,
    token: String,
) {
    let actor_ptid = actor_ptid.trim().to_string();
    let token = token.trim().to_string();
    if actor_ptid.is_empty() || token.is_empty() || !seen.insert(actor_ptid.clone()) {
        return;
    }
    sessions.push(WorkerSession { actor_ptid, token });
}

fn claim_and_execute(session: &WorkerSession) -> Result<(), String> {
    let executor_id = format!(
        "desktop-worker-{}-{}",
        session.actor_ptid,
        std::process::id()
    );
    let claim = app_orchestration::agent_collaboration_claim_executor_task(
        AgentCollaborationClaimExecutorInput {
            executor_id: executor_id.clone(),
            lease_ttl_ms: Some(WORKER_LEASE_TTL_MS),
            task_id: None,
            agent_id: None,
            node_id: None,
            capabilities: Some(vec!["cli".to_string()]),
        },
        &session.token,
    );
    let claim = payload_json(claim)?;
    if !bool_field(&claim, "claimed") {
        return Ok(());
    }
    let task =
        object_field(&claim, "task").ok_or_else(|| "claim response missing task".to_string())?;
    let node =
        object_field(&claim, "node").ok_or_else(|| "claim response missing node".to_string())?;
    let lease =
        object_field(&claim, "lease").ok_or_else(|| "claim response missing lease".to_string())?;
    let task_id = string_field(task, &["taskId", "task_id"])?;
    let node_id = string_field(node, &["nodeId", "node_id"])?;
    let station_agent_id = string_field(node, &["agentId", "agent_id"])?;
    let lease_id = string_field(lease, &["leaseId", "lease_id"])?;

    let detail = app_orchestration::agent_collaboration_get(
        AgentCollaborationGetInput {
            task_id: task_id.clone(),
        },
        &session.token,
    );
    let detail = payload_json(detail).unwrap_or_else(|_| claim.clone());
    let local_agent_id = resolve_local_agent_id(task, &station_agent_id).ok_or_else(|| {
        format!("local agent mapping not found for station agent {station_agent_id}")
    });
    let local_agent_id = match local_agent_id {
        Ok(value) => value,
        Err(error) => {
            submit_worker_result(
                session,
                &task_id,
                &node_id,
                &lease_id,
                &executor_id,
                "failed",
                &error,
                "",
            )?;
            return Ok(());
        }
    };
    let agent = local_agent_json(&session.actor_ptid, &session.token, &local_agent_id)?;
    let cli_command = value_string(&agent, &["cliCommand", "cli_command"]);
    if cli_command.is_empty() {
        let summary = format!("Local agent {local_agent_id} has no CLI command.");
        submit_worker_result(
            session,
            &task_id,
            &node_id,
            &lease_id,
            &executor_id,
            "failed",
            &summary,
            "",
        )?;
        return Ok(());
    }

    let stop_heartbeat = Arc::new(AtomicBool::new(false));
    let heartbeat_handle = start_heartbeat(
        session.token.clone(),
        lease_id.clone(),
        executor_id.clone(),
        Arc::clone(&stop_heartbeat),
    );
    let prompt = worker_prompt(&detail, node);
    let turn = app_agent_turn::agent_execute_turn(
        AgentExecuteTurnInput {
            stream_id: None,
            conversation_id: format!("{task_id}:{node_id}"),
            agent_id: local_agent_id.clone(),
            user_input: prompt,
            attachments: None,
            provider: Some(value_string(&agent, &["provider"])),
            model: Some(value_string(&agent, &["model"])),
            cli_command: Some(cli_command),
            workspace_mode: Some(value_string(&agent, &["workspaceMode", "workspace_mode"])),
            runtime_backend: Some(value_string(&agent, &["runtimeBackend", "runtime_backend"])),
            rootfs_path: Some(value_string(&agent, &["rootfsPath", "rootfs_path"])),
            allowed_roots: None,
            identity: Some(value_string(&agent, &["name", "title"])),
            agent_config_prompt: Some(value_string(&agent, &["systemPrompt", "system_prompt"])),
            effort: Some(value_string(&agent, &["effort"])),
            platform: Some("desktop-worker".to_string()),
            workspace_root: None,
            context_window_size: Some(128_000),
            max_retries: Some(3),
            knowledge_resources: None,
            available_tools: None,
            memory_disabled: None,
        },
        &session.token,
        &session.actor_ptid,
    );
    stop_heartbeat.store(true, Ordering::SeqCst);
    let _ = heartbeat_handle.join();

    match payload_json(turn) {
        Ok(turn_json) => {
            let summary = extract_turn_summary(&turn_json).unwrap_or_else(|| {
                "Desktop executor completed without returning a text summary.".to_string()
            });
            let turn_id = extract_turn_id(&turn_json).unwrap_or_default();
            renew_lease_before_submit(&session.token, &lease_id, &executor_id);
            submit_worker_result(
                session,
                &task_id,
                &node_id,
                &lease_id,
                &executor_id,
                "completed",
                &summary,
                &turn_id,
            )?;
        }
        Err(error) => {
            renew_lease_before_submit(&session.token, &lease_id, &executor_id);
            submit_worker_result(
                session,
                &task_id,
                &node_id,
                &lease_id,
                &executor_id,
                "failed",
                &error,
                "",
            )?;
        }
    }
    Ok(())
}

fn start_heartbeat(
    token: String,
    lease_id: String,
    executor_id: String,
    stop: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            thread::sleep(WORKER_HEARTBEAT_INTERVAL);
            if stop.load(Ordering::SeqCst) {
                break;
            }
            if let Err(error) = heartbeat_once(&token, &lease_id, &executor_id) {
                tracing::warn!(
                    lease_id = %lease_id,
                    executor_id = %executor_id,
                    error = %error,
                    "desktop executor lease heartbeat failed"
                );
            }
        }
    })
}

pub fn start(_state: Arc<AppState>) {
    if let Err(blocker) = enforce_canvas_single_agent_readiness() {
        tracing::info!(
            code = %blocker.error_type,
            required_gate = %blocker.details.get("required_gate").map_or("", String::as_str),
            "desktop executor worker blocked by single-Agent readiness"
        );
    }
}


fn heartbeat_once(token: &str, lease_id: &str, executor_id: &str) -> Result<(), String> {
    payload_json(
        app_orchestration::agent_collaboration_heartbeat_executor_lease(
            AgentCollaborationHeartbeatLeaseInput {
                lease_id: lease_id.to_string(),
                executor_id: executor_id.to_string(),
                lease_ttl_ms: Some(WORKER_LEASE_TTL_MS),
            },
            token,
        ),
    )
    .map(|_| ())
}

fn submit_worker_result(
    session: &WorkerSession,
    task_id: &str,
    node_id: &str,
    lease_id: &str,
    executor_id: &str,
    status: &str,
    summary: &str,
    turn_id: &str,
) -> Result<(), String> {
    payload_json(app_orchestration::agent_collaboration_submit_node_result(
        AgentCollaborationSubmitNodeResultInput {
            task_id: task_id.to_string(),
            node_id: node_id.to_string(),
            result_summary: summary.to_string(),
            status: Some(status.to_string()),
            turn_id: Some(turn_id.to_string()),
            lease_id: Some(lease_id.to_string()),
            executor_id: Some(executor_id.to_string()),
        },
        &session.token,
    ))?;
    let _ = app_orchestration::agent_collaboration_release_executor_lease(
        crate::contracts::AgentCollaborationReleaseLeaseInput {
            lease_id: lease_id.to_string(),
            executor_id: executor_id.to_string(),
            status: Some(status.to_string()),
        },
        &session.token,
    );
    Ok(())
}

fn local_agent_json(actor_ptid: &str, token: &str, agent_id: &str) -> Result<Value, String> {
    let result = payload_json(app_agents::agents_get(
        actor_ptid,
        token,
        AgentIdInput {
            id: agent_id.to_string(),
        },
    ));
    match result {
        Ok(value) => Ok(value),
        Err(error) if !actor_ptid.trim().is_empty() => payload_json(app_agents::agents_get(
            "",
            token,
            AgentIdInput {
                id: agent_id.to_string(),
            },
        ))
        .map_err(|_| error),
        Err(error) => Err(error),
    }
}

fn payload_json(result: AppResult<StubPayload>) -> Result<Value, String> {
    if !result.ok {
        return Err(result
            .error
            .map(|error| error.message)
            .unwrap_or_else(|| "operation failed".to_string()));
    }
    let payload = result
        .data
        .ok_or_else(|| "operation returned no data".to_string())?;
    serde_json::from_str(&payload.status).map_err(|error| format!("invalid payload JSON: {error}"))
}

fn resolve_local_agent_id(task: &Value, station_agent_id: &str) -> Option<String> {
    let meta = task.get("meta")?.as_object()?;
    let station_ids = parse_string_list(meta.get("agent_ids")?.as_str().unwrap_or_default());
    let desktop_ids =
        parse_string_list(meta.get("desktop_agent_ids")?.as_str().unwrap_or_default());
    station_ids
        .iter()
        .position(|id| id == station_agent_id)
        .and_then(|index| desktop_ids.get(index).cloned())
}

fn parse_string_list(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .unwrap_or_else(|_| raw.split(',').map(str::to_string).collect())
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn worker_prompt(detail: &Value, node: &Value) -> String {
    let role = value_string(node, &["role"]).to_lowercase();
    if role != "synthesizer" {
        return value_string(node, &["description"]);
    }
    let task = object_field(detail, "task");
    let goal = task
        .map(|task| value_string(task, &["description"]))
        .unwrap_or_default();
    let outputs = detail
        .get("nodes")
        .and_then(Value::as_array)
        .map(|nodes| {
            nodes
                .iter()
                .filter(|candidate| {
                    value_string(candidate, &["role"]).to_lowercase() != "synthesizer"
                })
                .enumerate()
                .map(|(index, candidate)| {
                    format!(
                        "{}. {}: {}",
                        index + 1,
                        value_string(candidate, &["agentId", "agent_id"]),
                        value_string(candidate, &["resultSummary", "result_summary"])
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    format!(
        "Synthesize the collaboration node outputs into the final result.\n\nTask:\n{}\n\nNode outputs:\n{}",
        goal, outputs
    )
}

fn extract_turn_summary(value: &Value) -> Option<String> {
    for key in [
        "result",
        "content",
        "text",
        "final_response",
        "finalResponse",
    ] {
        let value = value.get(key).and_then(Value::as_str).map(str::trim);
        if let Some(value) = value.filter(|value| !value.is_empty()) {
            return Some(value.to_string());
        }
    }
    None
}

fn extract_turn_id(value: &Value) -> Option<String> {
    for key in ["turnId", "turn_id", "id"] {
        let value = value.get(key).and_then(Value::as_str).map(str::trim);
        if let Some(value) = value.filter(|value| !value.is_empty()) {
            return Some(value.to_string());
        }
    }
    None
}

fn object_field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).filter(|value| value.is_object())
}

fn bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn string_field(value: &Value, keys: &[&str]) -> Result<String, String> {
    let value = value_string(value, keys);
    if value.is_empty() {
        return Err(format!("missing string field {}", keys.join("/")));
    }
    Ok(value)
}

fn value_string(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str).map(str::trim))
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::actor_device_identity::ActorDeviceIdentity;
    use crate::model::agent::{
        ClientCapabilityReceipt, ClientCapabilityReceiptStatus, ClientCapabilityRequest,
        ClientExecutionReplayPolicy, ClientResourceRef, ReceiptRecoveryCredential,
        ReceiptRecoveryScopePayload, ReceiptRecoverySigningPayload,
    };
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use fenced_executor::{
        CapabilityContract, CapabilityExecutor, ExecutionLease, FencedExecutor, ReceiptReporter,
    };
    use prost::Message;
    use receipt_ledger::ReceiptLedger;
    use resource_registry::{LocalResource, RegisterResource, ResourceRegistry};
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    #[test]
    fn desktop_executor_worker_fails_before_starting_any_runtime_effect() {
        let blocker =
            enforce_canvas_single_agent_readiness().expect_err("guard must remain closed");
        assert_eq!(blocker.error_type, CANVAS_READINESS_ERROR_CODE);
        assert_eq!(
            blocker.details.get("required_gate").map(String::as_str),
            Some(CANVAS_READINESS_REQUIRED_GATE),
        );
    }

    #[test]
    fn tool_call_receipt_persists_prepared_before_side_effect_and_replays_terminal() {
        let fixture = Fixture::new(false);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();
        let kernel = fixture.kernel(&executor, &reporter);

        let first = kernel
            .consume_at(envelope.clone(), fixture.now_ms)
            .expect("first delivery");
        assert_eq!(
            first.receipt.status,
            ClientCapabilityReceiptStatus::Applied as i32
        );
        assert!(first.side_effect_executed);
        assert_eq!(executor.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            reporter.statuses(),
            vec![
                ClientCapabilityReceiptStatus::Prepared as i32,
                ClientCapabilityReceiptStatus::Applied as i32,
            ]
        );
        assert_eq!(
            fixture.ledger.side_effect_counts().unwrap(),
            vec![receipt_ledger::ToolCallSideEffectCount {
                tool_call_id: envelope.tool_call_id.clone(),
                side_effect_count: 1,
            }]
        );

        let duplicate = kernel
            .consume_at(envelope.clone(), fixture.now_ms + 1)
            .expect("duplicate delivery");
        assert!(duplicate.duplicate);
        assert!(!duplicate.side_effect_executed);
        assert_eq!(duplicate.receipt.result_id, first.receipt.result_id);
        assert_eq!(executor.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            ReceiptLedger::open_test(&fixture.ledger_path)
                .unwrap()
                .side_effect_counts()
                .unwrap(),
            vec![receipt_ledger::ToolCallSideEffectCount {
                tool_call_id: envelope.tool_call_id,
                side_effect_count: 1,
            }]
        );
    }

    #[test]
    fn tool_call_side_effect_start_is_single_claim() {
        let fixture = Fixture::new(false);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        let prepared = prepared_for_test(&envelope, fixture.now_ms);
        fixture
            .ledger
            .prepare(&fixture.lease.station_url, &envelope, &prepared)
            .expect("persist PREPARED receipt");

        fixture
            .ledger
            .record_side_effect_start(&envelope)
            .expect("claim side-effect start");
        assert_eq!(
            fixture
                .ledger
                .record_side_effect_start(&envelope)
                .expect_err("duplicate side-effect start must fail"),
            "CLIENT_CAPABILITY_SIDE_EFFECT_ALREADY_STARTED"
        );
        assert_eq!(
            fixture.ledger.side_effect_counts().unwrap(),
            vec![receipt_ledger::ToolCallSideEffectCount {
                tool_call_id: envelope.tool_call_id,
                side_effect_count: 1,
            }]
        );
    }

    #[test]
    fn tool_call_receipt_restart_without_replay_settles_unknown_without_side_effect() {
        let fixture = Fixture::new(false);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        let prepared = prepared_for_test(&envelope, fixture.now_ms);
        fixture
            .ledger
            .prepare(&fixture.lease.station_url, &envelope, &prepared)
            .expect("persist crash barrier");
        let persisted = fixture.ledger.list().expect("scan persisted receipts");
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].station_url, fixture.lease.station_url);

        let reopened = ReceiptLedger::open_test(&fixture.ledger_path).expect("reopen ledger");
        let executor = RecordingExecutor::new(
            reopened.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();
        let kernel = FencedExecutor::new(
            &fixture.lease,
            &reopened,
            &fixture.resources,
            &fixture.signing_key_id,
            &fixture.signing_key,
            &executor,
            &reporter,
        );
        let recovered = kernel
            .consume_at(envelope, fixture.now_ms + 1)
            .expect("recover PREPARED receipt");

        assert_eq!(
            recovered.receipt.status,
            ClientCapabilityReceiptStatus::ReconciledUnknown as i32
        );
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
        assert!(reopened.side_effect_counts().unwrap().is_empty());
    }

    #[test]
    fn client_capability_same_fence_prepared_requires_station_takeover() {
        let fixture = Fixture::new(true);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::WithExternalIdempotency);
        fixture
            .ledger
            .prepare(
                &fixture.lease.station_url,
                &envelope,
                &prepared_for_test(&envelope, fixture.now_ms),
            )
            .expect("persist crash barrier");
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            true,
        );
        let reporter = RecordingReporter::default();
        let kernel = fixture.kernel(&executor, &reporter);

        let error = kernel
            .consume_at(envelope.clone(), fixture.now_ms + 1)
            .expect_err("same-fence PREPARED replay must require Station takeover");

        assert_eq!(error, "CLIENT_CAPABILITY_STATION_TAKEOVER_REQUIRED");
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
        let stored = fixture
            .ledger
            .load(&envelope.tool_call_id, envelope.fencing_token)
            .expect("load PREPARED receipt")
            .expect("PREPARED receipt remains durable");
        assert_eq!(
            stored.receipt.status,
            ClientCapabilityReceiptStatus::Prepared as i32
        );
    }

    #[test]
    fn client_capability_station_takeover_uses_a_distinct_higher_fence_attempt() {
        let mut fixture = Fixture::new(true);
        let original = fixture.envelope(ClientExecutionReplayPolicy::WithExternalIdempotency);
        fixture
            .ledger
            .prepare(
                &fixture.lease.station_url,
                &original,
                &prepared_for_test(&original, fixture.now_ms),
            )
            .expect("persist original PREPARED attempt");

        fixture.lease.capability_session_id = "session-2".to_string();
        fixture.lease.executor_lease_id = "lease-2".to_string();
        fixture.lease.lease_revision += 1;
        let mut takeover = original.clone();
        takeover.request_id = "request-2".to_string();
        takeover.capability_session_id = fixture.lease.capability_session_id.clone();
        takeover.executor_lease_id = fixture.lease.executor_lease_id.clone();
        takeover.capability_lease_revision = fixture.lease.lease_revision;
        takeover.fencing_token += 1;
        takeover.dispatch_sequence += 1;
        takeover.sequence = takeover.dispatch_sequence;
        refresh_hashes(&mut takeover, &fixture.lease.actor_ptid);

        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            takeover.tool_call_id.clone(),
            takeover.fencing_token,
            true,
        );
        let reporter = RecordingReporter::default();
        let consumed = fixture
            .kernel(&executor, &reporter)
            .consume_at(takeover.clone(), fixture.now_ms + 1)
            .expect("consume Station takeover envelope");

        assert!(consumed.side_effect_executed);
        assert_eq!(
            executor.idempotency_keys.lock().unwrap().as_slice(),
            [original.external_idempotency_key]
        );
        assert!(fixture
            .ledger
            .load(&original.tool_call_id, original.fencing_token)
            .unwrap()
            .is_some());
        assert!(fixture
            .ledger
            .load(&takeover.tool_call_id, takeover.fencing_token)
            .unwrap()
            .is_some());
    }

    #[test]
    fn client_capability_rejects_stale_authority_before_prepared() {
        let fixture = Fixture::new(false);
        let mut envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        envelope.capability_lease_revision += 1;
        refresh_hashes(&mut envelope, &fixture.lease.actor_ptid);
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();
        let error = fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope.clone(), fixture.now_ms)
            .expect_err("stale revision must fail");

        assert_eq!(error, "CLIENT_CAPABILITY_AUTHORITY_MISMATCH");
        assert!(fixture
            .ledger
            .load(&envelope.tool_call_id, envelope.fencing_token)
            .unwrap()
            .is_none());
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn client_capability_rejects_receipt_from_another_station() {
        let mut fixture = Fixture::new(false);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        fixture
            .ledger
            .prepare(
                &fixture.lease.station_url,
                &envelope,
                &prepared_for_test(&envelope, fixture.now_ms),
            )
            .expect("persist first Station receipt");
        fixture.lease.station_url = "https://other-station.example".to_string();
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();

        let error = fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope, fixture.now_ms + 1)
            .expect_err("receipt authority must remain Station-scoped");

        assert_eq!(error, "CLIENT_CAPABILITY_ENVELOPE_CONFLICT");
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
        assert!(reporter.statuses().is_empty());
    }

    #[test]
    fn client_capability_revoke_stops_before_prepared() {
        let mut fixture = Fixture::new(false);
        fixture.lease.revoked = true;
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();

        let error = fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope.clone(), fixture.now_ms)
            .expect_err("revoked lease must stop before PREPARED");

        assert_eq!(error, "CLIENT_CAPABILITY_LEASE_INACTIVE");
        assert!(fixture
            .ledger
            .load(&envelope.tool_call_id, envelope.fencing_token)
            .unwrap()
            .is_none());
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn client_capability_expiry_stops_restart_replay_before_side_effect() {
        let mut fixture = Fixture::new(true);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::WithExternalIdempotency);
        fixture
            .ledger
            .prepare(
                &fixture.lease.station_url,
                &envelope,
                &prepared_for_test(&envelope, fixture.now_ms),
            )
            .expect("persist crash barrier");
        fixture.lease.expires_at_ms = fixture.now_ms;
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            true,
        );
        let reporter = RecordingReporter::default();

        let error = fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope, fixture.now_ms + 1)
            .expect_err("expired lease must not replay a side effect");

        assert_eq!(error, "CLIENT_CAPABILITY_LEASE_INACTIVE");
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn client_capability_resolves_actor_device_scoped_opaque_resource() {
        let fixture = Fixture::new(false);
        fixture
            .resources
            .register(RegisterResource {
                opaque_ref: "resource-1",
                capability_session_id: &fixture.lease.capability_session_id,
                capability_id: "filesystem.read",
                permission_grant_id: "grant-1",
                integrity_hash: "sha256:file",
                locator: "/private/device/alice/workspace",
                expires_at_ms: fixture.now_ms + 120_000,
            })
            .expect("register opaque resource");
        let mut envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        envelope.resource_refs = vec![ClientResourceRef {
            resource_ref: "resource-1".to_string(),
            ptid: fixture.lease.actor_ptid.clone(),
            device_id: fixture.lease.device_id.clone(),
            capability_session_id: fixture.lease.capability_session_id.clone(),
            capability_id: envelope.capability_id.clone(),
            expires_at: Some(timestamp(fixture.now_ms + 120_000)),
            permission_grant_id: "grant-1".to_string(),
            integrity_hash: "sha256:file".to_string(),
        }];
        refresh_hashes(&mut envelope, &fixture.lease.actor_ptid);
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();

        fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope, fixture.now_ms)
            .expect("consume opaque resource");

        let resources = executor.resources.lock().unwrap();
        assert_eq!(resources.len(), 1);
        assert_eq!(resources[0].opaque_ref, "resource-1");
        assert_eq!(resources[0].locator, "/private/device/alice/workspace");
    }

    #[test]
    fn tool_call_receipt_late_recovery_is_signed_and_terminal_only() {
        let mut fixture = Fixture::new(false);
        let envelope = fixture.envelope(ClientExecutionReplayPolicy::NoReplayAfterPrepared);
        fixture
            .ledger
            .prepare(
                &fixture.lease.station_url,
                &envelope,
                &prepared_for_test(&envelope, fixture.now_ms),
            )
            .expect("persist crash barrier");
        fixture.lease.revoked = true;
        let executor = RecordingExecutor::new(
            fixture.ledger.clone(),
            envelope.tool_call_id.clone(),
            envelope.fencing_token,
            false,
        );
        let reporter = RecordingReporter::default();
        let recovered = fixture
            .kernel(&executor, &reporter)
            .consume_at(envelope.clone(), fixture.now_ms + 61_000)
            .expect("signed terminal recovery");
        let proof = recovered
            .receipt
            .recovery_proof
            .as_ref()
            .expect("recovery proof");
        let credential = envelope.recovery_credential.as_ref().unwrap();
        let payload = ReceiptRecoverySigningPayload {
            domain: recovery_signer::RECEIPT_RECOVERY_DOMAIN.to_string(),
            credential_id: credential.credential_id.clone(),
            nonce: credential.nonce.clone(),
            device_signing_key_id: credential.device_signing_key_id.clone(),
            scope_hash: credential.scope_hash.clone(),
            receipt_digest: recovery_signer::receipt_digest(&recovered.receipt),
        };
        let public_key = ed25519_dalek::VerifyingKey::from(&fixture.signing_key);
        let public_key: [u8; 32] = public_key.to_bytes();
        let signature: [u8; 64] = proof
            .signature
            .clone()
            .try_into()
            .expect("Ed25519 signature");
        VerifyingKey::from_bytes(&public_key)
            .unwrap()
            .verify(&payload.encode_to_vec(), &Signature::from_bytes(&signature))
            .expect("valid recovery signature");
        assert_eq!(
            recovered.receipt.status,
            ClientCapabilityReceiptStatus::ReconciledUnknown as i32
        );
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    }

    struct Fixture {
        now_ms: i64,
        ledger_path: std::path::PathBuf,
        ledger: ReceiptLedger,
        resources: ResourceRegistry,
        identity: ActorDeviceIdentity,
        signing_key_id: String,
        signing_key: ed25519_dalek::SigningKey,
        lease: ExecutionLease,
    }

    impl Fixture {
        fn new(_supports_external_idempotency: bool) -> Self {
            let now_ms = current_time_ms();
            let root = std::env::temp_dir().join(format!("g1-c-{}", ulid::Ulid::new()));
            std::fs::create_dir_all(&root).unwrap();
            let ledger_path = root.join("receipts.db");
            let actor_ptid = "ptid:test:alice";
            let device_id = "alice-device";
            let identity = ActorDeviceIdentity::new();
            identity.init(actor_ptid, device_id).unwrap();
            let signing_key = ed25519_dalek::SigningKey::generate(&mut rand::rngs::OsRng);
            let signing_key_id = format!(
                "{}",
                hex::encode(sha2::Sha256::digest(
                    ed25519_dalek::VerifyingKey::from(&signing_key).as_bytes()
                ))
            );
            Self {
                now_ms,
                ledger: ReceiptLedger::open_test(&ledger_path).unwrap(),
                ledger_path,
                resources: ResourceRegistry::open_test(
                    &root.join("resources.db"),
                    actor_ptid,
                    device_id,
                )
                .unwrap(),
                identity,
                signing_key_id,
                signing_key,
                lease: ExecutionLease {
                    station_url: "https://station.example".to_string(),
                    actor_ptid: actor_ptid.to_string(),
                    device_id: device_id.to_string(),
                    capability_session_id: "session-1".to_string(),
                    executor_lease_id: "lease-1".to_string(),
                    lease_revision: 7,
                    expires_at_ms: now_ms + 60_000,
                    revoked: false,
                },
            }
        }

        fn envelope(&self, replay_policy: ClientExecutionReplayPolicy) -> ClientCapabilityRequest {
            let signing_key_id = self.signing_key_id.clone();
            let mut envelope = ClientCapabilityRequest {
                request_id: "request-1".to_string(),
                turn_id: "turn-1".to_string(),
                tool_call_id: "tool-call-1".to_string(),
                capability_session_id: self.lease.capability_session_id.clone(),
                capability_id: "filesystem.read".to_string(),
                schema_version: "1".to_string(),
                resource_refs: Vec::new(),
                bounded_arguments: br#"{"path":"note.txt"}"#.to_vec(),
                approval_id: "approval-1".to_string(),
                sequence: 11,
                attempt_id: "attempt-1".to_string(),
                target_device_id: self.lease.device_id.clone(),
                decision_id: "decision-1".to_string(),
                decision_revision: 3,
                execution_claim_id: "claim-1".to_string(),
                executor_lease_id: self.lease.executor_lease_id.clone(),
                fencing_token: 5,
                dispatch_sequence: 11,
                payload_hash: String::new(),
                execution_deadline: Some(timestamp(self.now_ms + 30_000)),
                tool_batch_id: "batch-1".to_string(),
                replay_policy: replay_policy as i32,
                external_idempotency_key: if replay_policy
                    == ClientExecutionReplayPolicy::WithExternalIdempotency
                {
                    "station-issued-key".to_string()
                } else {
                    String::new()
                },
                recovery_credential: None,
                reconciliation_deadline: Some(timestamp(self.now_ms + 120_000)),
                capability_lease_revision: self.lease.lease_revision,
            };
            envelope.payload_hash = payload_hash(&envelope);
            envelope.recovery_credential = Some(ReceiptRecoveryCredential {
                credential_id: "credential-1".to_string(),
                device_signing_key_id: signing_key_id,
                nonce: vec![7; 32],
                scope_hash: String::new(),
                expires_at: envelope.reconciliation_deadline.clone(),
            });
            refresh_hashes(&mut envelope, &self.lease.actor_ptid);
            envelope
        }

        fn kernel<'a>(
            &'a self,
            executor: &'a dyn CapabilityExecutor,
            reporter: &'a dyn ReceiptReporter,
        ) -> FencedExecutor<'a> {
            FencedExecutor::new(
                &self.lease,
                &self.ledger,
                &self.resources,
                &self.signing_key_id,
                &self.signing_key,
                executor,
                reporter,
            )
        }
    }

    struct RecordingExecutor {
        ledger: ReceiptLedger,
        tool_call_id: String,
        fencing_token: u64,
        supports_external_idempotency: bool,
        calls: AtomicUsize,
        idempotency_keys: Mutex<Vec<String>>,
        resources: Mutex<Vec<LocalResource>>,
    }

    impl RecordingExecutor {
        fn new(
            ledger: ReceiptLedger,
            tool_call_id: String,
            fencing_token: u64,
            supports_external_idempotency: bool,
        ) -> Self {
            Self {
                ledger,
                tool_call_id,
                fencing_token,
                supports_external_idempotency,
                calls: AtomicUsize::new(0),
                idempotency_keys: Mutex::new(Vec::new()),
                resources: Mutex::new(Vec::new()),
            }
        }
    }

    impl CapabilityExecutor for RecordingExecutor {
        fn contract(&self, capability_id: &str) -> Option<CapabilityContract> {
            Some(CapabilityContract {
                capability_id: capability_id.to_string(),
                schema_version: "1".to_string(),
                max_argument_bytes: 4096,
                max_result_bytes: 4096,
                supports_external_idempotency: self.supports_external_idempotency,
            })
        }

        fn execute(
            &self,
            _request: &ClientCapabilityRequest,
            resources: &[LocalResource],
            external_idempotency_key: Option<&str>,
            record_side_effect_start: &mut dyn FnMut() -> Result<(), String>,
        ) -> Result<Vec<u8>, String> {
            let persisted = self
                .ledger
                .load(&self.tool_call_id, self.fencing_token)?
                .ok_or_else(|| "PREPARED was not durable before side effect".to_string())?;
            if persisted.receipt.status != ClientCapabilityReceiptStatus::Prepared as i32 {
                return Err("PREPARED was not durable before side effect".to_string());
            }
            record_side_effect_start()?;
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(key) = external_idempotency_key {
                self.idempotency_keys.lock().unwrap().push(key.to_string());
            }
            self.resources.lock().unwrap().extend_from_slice(resources);
            Ok(br#"{"ok":true}"#.to_vec())
        }
    }

    #[derive(Default)]
    struct RecordingReporter {
        receipts: Mutex<Vec<ClientCapabilityReceipt>>,
    }

    impl RecordingReporter {
        fn statuses(&self) -> Vec<i32> {
            self.receipts
                .lock()
                .unwrap()
                .iter()
                .map(|receipt| receipt.status)
                .collect()
        }
    }

    impl ReceiptReporter for RecordingReporter {
        fn submit(&self, receipt: &ClientCapabilityReceipt) -> Result<(), String> {
            self.receipts.lock().unwrap().push(receipt.clone());
            Ok(())
        }
    }

    fn prepared_for_test(
        envelope: &ClientCapabilityRequest,
        now_ms: i64,
    ) -> ClientCapabilityReceipt {
        ClientCapabilityReceipt {
            request_id: envelope.request_id.clone(),
            turn_id: envelope.turn_id.clone(),
            tool_call_id: envelope.tool_call_id.clone(),
            capability_session_id: envelope.capability_session_id.clone(),
            target_device_id: envelope.target_device_id.clone(),
            decision_id: envelope.decision_id.clone(),
            decision_revision: envelope.decision_revision,
            execution_claim_id: envelope.execution_claim_id.clone(),
            executor_lease_id: envelope.executor_lease_id.clone(),
            fencing_token: envelope.fencing_token,
            dispatch_sequence: envelope.dispatch_sequence,
            payload_hash: envelope.payload_hash.clone(),
            side_effect_receipt_id: "receipt-crash".to_string(),
            status: ClientCapabilityReceiptStatus::Prepared as i32,
            bounded_result: Vec::new(),
            error_code: String::new(),
            sequence: envelope.sequence,
            occurred_at: Some(timestamp(now_ms)),
            result_id: String::new(),
            tool_batch_id: envelope.tool_batch_id.clone(),
            recovery_proof: None,
        }
    }

    fn refresh_hashes(envelope: &mut ClientCapabilityRequest, actor_ptid: &str) {
        envelope.payload_hash = payload_hash(envelope);
        let credential = envelope.recovery_credential.as_ref().unwrap();
        let scope = ReceiptRecoveryScopePayload {
            actor_ptid: actor_ptid.to_string(),
            device_id: envelope.target_device_id.clone(),
            request_id: envelope.request_id.clone(),
            tool_call_id: envelope.tool_call_id.clone(),
            execution_claim_id: envelope.execution_claim_id.clone(),
            capability_lease_revision: envelope.capability_lease_revision,
            fencing_token: envelope.fencing_token,
            payload_hash: envelope.payload_hash.clone(),
            replay_policy: envelope.replay_policy,
            execution_deadline: envelope.execution_deadline.clone(),
            reconciliation_deadline: envelope.reconciliation_deadline.clone(),
            credential_id: credential.credential_id.clone(),
            device_signing_key_id: credential.device_signing_key_id.clone(),
            nonce: credential.nonce.clone(),
        };
        envelope.recovery_credential.as_mut().unwrap().scope_hash =
            hex::encode(Sha256::digest(scope.encode_to_vec()));
    }

    fn payload_hash(envelope: &ClientCapabilityRequest) -> String {
        let mut canonical = envelope.clone();
        canonical.payload_hash.clear();
        canonical.recovery_credential = None;
        hex::encode(Sha256::digest(canonical.encode_to_vec()))
    }

    fn timestamp(milliseconds: i64) -> prost_types::Timestamp {
        prost_types::Timestamp {
            seconds: milliseconds / 1_000,
            nanos: ((milliseconds % 1_000) * 1_000_000) as i32,
        }
    }

    fn current_time_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    }
}
