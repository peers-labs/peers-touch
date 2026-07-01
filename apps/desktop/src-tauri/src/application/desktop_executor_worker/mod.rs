use crate::application::agent_orchestration as app_orchestration;
use crate::application::agent_turn as app_agent_turn;
use crate::application::agents as app_agents;
use crate::contracts::{
    AgentCollaborationClaimExecutorInput, AgentCollaborationGetInput,
    AgentCollaborationHeartbeatLeaseInput, AgentCollaborationReleaseLeaseInput,
    AgentCollaborationSubmitNodeResultInput, AgentExecuteTurnInput, AgentIdInput, StubPayload,
};
use crate::error::AppResult;
use crate::state::AppState;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;

const WORKER_POLL_INTERVAL: Duration = Duration::from_millis(1500);
const WORKER_LEASE_TTL_MS: i64 = 300_000;
const WORKER_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone)]
struct WorkerSession {
    actor_id: String,
    token: String,
}

pub fn start(state: Arc<AppState>) {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }
    thread::Builder::new()
        .name("desktop-executor-worker".to_string())
        .spawn(move || run_loop(state))
        .expect("failed to start desktop executor worker");
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
    if let Ok(guard) = state.session.lock() {
        if let (Some(actor_id), Some(token)) = (guard.actor_id.clone(), guard.token.clone()) {
            push_session(&mut sessions, &mut seen, actor_id, token);
        }
    }
    for session in state.sessions.snapshot_all() {
        push_session(
            &mut sessions,
            &mut seen,
            session.actor.actor_id,
            session.jwt,
        );
    }
    sessions
}

fn push_session(
    sessions: &mut Vec<WorkerSession>,
    seen: &mut HashSet<String>,
    actor_id: String,
    token: String,
) {
    let actor_id = actor_id.trim().to_string();
    let token = token.trim().to_string();
    if actor_id.is_empty() || token.is_empty() || !seen.insert(actor_id.clone()) {
        return;
    }
    sessions.push(WorkerSession { actor_id, token });
}

fn claim_and_execute(session: &WorkerSession) -> Result<(), String> {
    let executor_id = format!("desktop-worker-{}-{}", session.actor_id, std::process::id());
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
    let task = object_field(&claim, "task").ok_or_else(|| "claim response missing task".to_string())?;
    let node = object_field(&claim, "node").ok_or_else(|| "claim response missing node".to_string())?;
    let lease = object_field(&claim, "lease").ok_or_else(|| "claim response missing lease".to_string())?;
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
    let local_agent_id = resolve_local_agent_id(task, &station_agent_id)
        .ok_or_else(|| format!("local agent mapping not found for station agent {station_agent_id}"));
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
    let agent = local_agent_json(&session.actor_id, &local_agent_id)?;
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
        },
        &session.token,
    );
    stop_heartbeat.store(true, Ordering::SeqCst);
    let _ = heartbeat_handle.join();

    match payload_json(turn) {
        Ok(turn_json) => {
            let summary = extract_turn_summary(&turn_json)
                .unwrap_or_else(|| "Desktop executor completed without returning a text summary.".to_string());
            submit_worker_result(
                session,
                &task_id,
                &node_id,
                &lease_id,
                &executor_id,
                "completed",
                &summary,
                "",
            )?;
        }
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
            let _ = app_orchestration::agent_collaboration_heartbeat_executor_lease(
                AgentCollaborationHeartbeatLeaseInput {
                    lease_id: lease_id.clone(),
                    executor_id: executor_id.clone(),
                    lease_ttl_ms: Some(WORKER_LEASE_TTL_MS),
                },
                &token,
            );
        }
    })
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

fn local_agent_json(actor_id: &str, agent_id: &str) -> Result<Value, String> {
    payload_json(app_agents::agents_get(
        actor_id,
        AgentIdInput {
            id: agent_id.to_string(),
        },
    ))
}

fn payload_json(result: AppResult<StubPayload>) -> Result<Value, String> {
    if !result.ok {
        return Err(result
            .error
            .map(|error| error.message)
            .unwrap_or_else(|| "operation failed".to_string()));
    }
    let payload = result.data.ok_or_else(|| "operation returned no data".to_string())?;
    serde_json::from_str(&payload.status).map_err(|error| format!("invalid payload JSON: {error}"))
}

fn resolve_local_agent_id(task: &Value, station_agent_id: &str) -> Option<String> {
    let meta = task.get("meta")?.as_object()?;
    let station_ids = parse_string_list(meta.get("agent_ids")?.as_str().unwrap_or_default());
    let desktop_ids = parse_string_list(meta.get("desktop_agent_ids")?.as_str().unwrap_or_default());
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
                .filter(|candidate| value_string(candidate, &["role"]).to_lowercase() != "synthesizer")
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
    for key in ["result", "content", "text", "final_response", "finalResponse"] {
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
