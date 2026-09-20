use crate::application::desktop_executor_worker::supervisor::{
    CapabilityWorkerSnapshot, CapabilityWorkerSupervisor, RequestedCapabilityNegativeControl,
};
use crate::contracts::{AgentRuntimeActivityInput, AgentRuntimeProfileInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::agent;
use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const RUNTIME_ID_EXTERNAL_AGENT: &str = "external-agent";
const RUNTIME_ID_TRAE_CLI: &str = "trae-cli";
const AS_F10_NEGATIVE_CONTROL_ENV: &str = "PT_AGENT_AS_F10_NEGATIVE_CONTROL";
const GFE1_EXECUTOR_CONTROL_ENV: &str = "PT_AGENT_GFE1_EXECUTOR_CONTROL";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilitySessionSnapshotInput {
    pub negative_control: Option<AgentCapabilityNegativeControlInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilityNegativeControlInput {
    pub control: String,
    pub capability_session_id_hash: String,
    pub cross_device_session_id: Option<String>,
}

#[derive(Clone, Copy, Default)]
struct LocalRuntimeActivityCounters {
    runtime_bindings_created: u64,
    external_sessions_created: u64,
    runtime_homes_created: u64,
    processes_started: u64,
    workspaces_created: u64,
}

#[derive(Default)]
struct LocalRuntimeActivityRegistry {
    counters: Mutex<HashMap<(String, String), LocalRuntimeActivityCounters>>,
}

static LOCAL_RUNTIME_ACTIVITY: OnceLock<LocalRuntimeActivityRegistry> = OnceLock::new();
static LOCAL_RUNTIME_INSTANCE_ID: OnceLock<String> = OnceLock::new();
static LOCAL_RUNTIME_COUNTER_EPOCH: OnceLock<String> = OnceLock::new();

fn local_registry() -> &'static LocalRuntimeActivityRegistry {
    LOCAL_RUNTIME_ACTIVITY.get_or_init(LocalRuntimeActivityRegistry::default)
}

fn local_instance_id() -> &'static str {
    LOCAL_RUNTIME_INSTANCE_ID
        .get_or_init(|| format!("desktop-runtime-{}", ulid::Ulid::new()))
        .as_str()
}

fn local_counter_epoch() -> &'static str {
    LOCAL_RUNTIME_COUNTER_EPOCH
        .get_or_init(|| format!("desktop-boot-{}", ulid::Ulid::new()))
        .as_str()
}

pub fn effective_runtime_profile(
    input: AgentRuntimeProfileInput,
    token: &str,
) -> AppResult<StubPayload> {
    let request = agent::GetEffectiveRuntimeProfileRequest {
        agent_id: input.agent_id.trim().to_string(),
    };
    let response = match station_client::request_proto::<_, agent::GetEffectiveRuntimeProfileResponse>(
        Method::POST,
        "/sub-agent/agent/runtime/profile/effective",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("agent.runtimeProfileReadbackFailed"),
    };
    let Some(snapshot) = response.snapshot else {
        return AppResult::fail(
            ErrorCode::InternalError,
            "agent.runtimeProfileSnapshotMissing",
            None,
        );
    };

    success_payload(
        "agent_runtime_profile_effective",
        json!({
            "snapshot_id": snapshot.snapshot_id,
            "ptid": snapshot.ptid,
            "agent_id": snapshot.agent_id,
            "profile_id": snapshot.profile_id,
            "profile_revision": snapshot.profile_revision,
            "readiness_snapshot_id": snapshot.readiness_snapshot_id,
            "runtimes": snapshot.runtimes.iter().map(runtime_advertisement_json).collect::<Vec<_>>(),
            "observed_at": timestamp_json(snapshot.observed_at.as_ref()),
        }),
    )
}

pub fn station_capability_sessions(token: &str) -> AppResult<StubPayload> {
    let response =
        match station_client::request_proto::<_, agent::ListClientCapabilitySessionsResponse>(
            Method::POST,
            "/sub-agent/agent/capability/session/list",
            token,
            None,
            Some(&agent::ListClientCapabilitySessionsRequest {}),
        ) {
            Ok(response) => response,
            Err(error) => return error.into_app_result("agent.capabilitySessionReadbackFailed"),
        };
    success_payload(
        "agent_capability_sessions",
        json!({
            "sessions": response.sessions.iter().map(capability_session_json).collect::<Vec<_>>(),
        }),
    )
}

pub fn station_runtime_activity(
    input: AgentRuntimeActivityInput,
    token: &str,
) -> AppResult<StubPayload> {
    let request = match runtime_activity_request(&input) {
        Ok(request) => request,
        Err(error) => return error,
    };
    let response = match request_station_activity(&request, token) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("agent.runtimeActivityReadbackFailed"),
    };
    let Some(snapshot) = response.snapshot else {
        return AppResult::fail(
            ErrorCode::InternalError,
            "agent.runtimeActivitySnapshotMissing",
            None,
        );
    };
    success_payload(
        "agent_runtime_activity_station",
        runtime_activity_json(&snapshot),
    )
}

pub fn local_runtime_activity(
    input: AgentRuntimeActivityInput,
    token: &str,
) -> AppResult<StubPayload> {
    let request = match runtime_activity_request(&input) {
        Ok(request) => request,
        Err(error) => return error,
    };
    let station = match request_station_activity(&request, token) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("agent.runtimeActivityActorBindingFailed"),
    };
    let Some(station_snapshot) = station.snapshot else {
        return AppResult::fail(
            ErrorCode::InternalError,
            "agent.runtimeActivitySnapshotMissing",
            None,
        );
    };

    let key = (
        station_snapshot.ptid.clone(),
        station_snapshot.runtime_id.clone(),
    );
    let counters = match local_registry().counters.lock() {
        Ok(counters) => counters.get(&key).copied().unwrap_or_default(),
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "agent.runtimeActivityRegistryUnavailable",
                None,
            )
        }
    };
    success_payload(
        "agent_runtime_activity_local",
        json!({
            "snapshot_id": format!("desktop-runtime-activity-{}", ulid::Ulid::new()),
            "owner": "desktop-rust",
            "owner_instance_id": local_instance_id(),
            "ptid": station_snapshot.ptid,
            "runtime_kind": runtime_kind_name(station_snapshot.runtime_kind),
            "runtime_id": station_snapshot.runtime_id,
            "counter_epoch": local_counter_epoch(),
            "counters": counters_json(counters),
            "observed_at_unix_ms": unix_time_millis(),
        }),
    )
}

pub fn capability_session_snapshot(
    workers: Vec<CapabilityWorkerSnapshot>,
) -> AppResult<StubPayload> {
    let sessions = workers
        .into_iter()
        .map(|worker| {
            json!({
                "actor_id_hash": hash_identifier(&worker.actor_ptid),
                "device_id_hash": hash_identifier(&worker.device_id),
                "capability_session_id_hash": hash_identifier(&worker.capability_session_id),
                "lease_id_hash": hash_identifier(&worker.lease_id),
                "lease_revision": worker.lease_revision,
                "capability_set_hash": worker.capability_set_hash,
                "platform": runtime_platform_name(worker.platform),
                "capability_ids": worker.capability_ids,
                "local_execution_attempt_count": worker.local_execution_attempt_count,
                "local_side_effect_count": worker.local_side_effect_count,
                "tool_call_side_effect_counts": worker.tool_call_side_effect_counts.iter().map(|count| json!({
                    "tool_call_id": count.tool_call_id,
                    "side_effect_count": count.side_effect_count,
                })).collect::<Vec<_>>(),
                "expires_at_ms": worker.expires_at_ms,
            })
        })
        .collect::<Vec<_>>();
    success_payload(
        "agent_capability_session_snapshot",
        json!({
            "active_session_count": sessions.len(),
            "sessions": sessions,
        }),
    )
}

pub fn capability_negative_control(
    input: AgentCapabilityNegativeControlInput,
    supervisor: &CapabilityWorkerSupervisor,
) -> AppResult<StubPayload> {
    if !negative_control_feature_enabled() {
        return AppResult::fail(
            ErrorCode::NotImplemented,
            "agent.capabilityNegativeControlUnavailable",
            Some(json!({ "reason": "acceptanceFeatureDisabled" })),
        );
    }
    if std::env::var(AS_F10_NEGATIVE_CONTROL_ENV).as_deref() != Ok("1") {
        return AppResult::fail(
            ErrorCode::Forbidden,
            "agent.capabilityNegativeControlUnavailable",
            Some(json!({ "reason": "acceptanceEnvironmentDisabled" })),
        );
    }
    let Some(control) = requested_negative_control(&input.control) else {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "agent.capabilityNegativeControlInvalid",
            None,
        );
    };
    if control.requires_lease_lifecycle_control()
        && std::env::var(GFE1_EXECUTOR_CONTROL_ENV).as_deref() != Ok("1")
    {
        return AppResult::fail(
            ErrorCode::Forbidden,
            "agent.capabilityNegativeControlUnavailable",
            Some(json!({ "reason": "leaseControlEnvironmentDisabled" })),
        );
    }
    match supervisor.emit_negative_control(
        control,
        input.capability_session_id_hash,
        input.cross_device_session_id,
    ) {
        Ok(facts) => match serde_json::to_value(facts) {
            Ok(value) => success_payload("agent_capability_negative_control", value),
            Err(error) => AppResult::fail(
                ErrorCode::InternalError,
                "agent.capabilityNegativeControlSerializationFailed",
                Some(json!({ "cause": error.to_string() })),
            ),
        },
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            "agent.capabilityNegativeControlFailed",
            Some(json!({ "cause": error })),
        ),
    }
}

fn requested_negative_control(value: &str) -> Option<RequestedCapabilityNegativeControl> {
    match value {
        "unsupported" => Some(RequestedCapabilityNegativeControl::Unsupported),
        "unauthorized" => Some(RequestedCapabilityNegativeControl::Unauthorized),
        "signatureTamper" => Some(RequestedCapabilityNegativeControl::SignatureTamper),
        "schemaMismatch" => Some(RequestedCapabilityNegativeControl::SchemaMismatch),
        "crossDevice" => Some(RequestedCapabilityNegativeControl::CrossDevice),
        "leasePause" => Some(RequestedCapabilityNegativeControl::LeasePause),
        "leaseExpired" => Some(RequestedCapabilityNegativeControl::LeaseExpired),
        _ => None,
    }
}

#[cfg(feature = "acceptance-webdriver")]
fn negative_control_feature_enabled() -> bool {
    true
}

#[cfg(not(feature = "acceptance-webdriver"))]
fn negative_control_feature_enabled() -> bool {
    false
}

pub fn open_browser_capability_session(
    supervisor: &crate::application::desktop_executor_worker::CapabilityWorkerSupervisor,
) -> AppResult<StubPayload> {
    if !supervisor.is_browser_surface() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "agent.browserCapabilitySessionRequiresBrowserSurface",
            None,
        );
    }
    match supervisor.start() {
        Ok(()) => success_payload(
            "agent_browser_capability_session_open",
            json!({ "state": "starting" }),
        ),
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            "agent.browserCapabilitySessionStartFailed",
            Some(json!({ "cause": error })),
        ),
    }
}

pub fn close_browser_capability_session(
    supervisor: &crate::application::desktop_executor_worker::CapabilityWorkerSupervisor,
) -> AppResult<StubPayload> {
    if !supervisor.is_browser_surface() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "agent.browserCapabilitySessionRequiresBrowserSurface",
            None,
        );
    }
    match supervisor.shutdown() {
        Ok(()) => success_payload(
            "agent_browser_capability_session_close",
            json!({ "state": "closed" }),
        ),
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            "agent.browserCapabilitySessionStopFailed",
            Some(json!({ "cause": error })),
        ),
    }
}

pub fn set_client_executor_supervisor_available(
    supervisor: &CapabilityWorkerSupervisor,
    available: bool,
) -> AppResult<StubPayload> {
    if supervisor.is_browser_surface() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "agent.clientExecutorSupervisorRequiresDesktopSurface",
            None,
        );
    }
    if !executor_control_feature_enabled() {
        return AppResult::fail(
            ErrorCode::NotImplemented,
            "agent.capabilitySupervisorControlUnavailable",
            Some(json!({ "reason": "acceptanceFeatureDisabled" })),
        );
    }
    if std::env::var(GFE1_EXECUTOR_CONTROL_ENV).as_deref() != Ok("1") {
        return AppResult::fail(
            ErrorCode::Forbidden,
            "agent.capabilitySupervisorControlUnavailable",
            Some(json!({ "reason": "acceptanceEnvironmentDisabled" })),
        );
    }

    let result = if available {
        supervisor.start()
    } else {
        supervisor.shutdown()
    };
    match result {
        Ok(()) => success_payload(
            "agent_client_executor_supervisor_control",
            json!({
                "available": available,
                "state": if available { "starting" } else { "stopped" },
            }),
        ),
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            "agent.capabilitySupervisorControlFailed",
            Some(json!({ "cause": error })),
        ),
    }
}

#[cfg(feature = "acceptance-webdriver")]
fn executor_control_feature_enabled() -> bool {
    true
}

#[cfg(not(feature = "acceptance-webdriver"))]
fn executor_control_feature_enabled() -> bool {
    false
}

fn runtime_activity_request(
    input: &AgentRuntimeActivityInput,
) -> Result<agent::GetRuntimeActivityRequest, AppResult<StubPayload>> {
    let runtime_id = input.runtime_id.trim();
    let runtime_kind =
        agent::RuntimeKind::try_from(input.runtime_kind).unwrap_or(agent::RuntimeKind::Unspecified);
    let valid = matches!(
        (runtime_kind, runtime_id),
        (agent::RuntimeKind::DirectModel, RUNTIME_ID_TRAE_CLI)
            | (agent::RuntimeKind::ExternalAgent, RUNTIME_ID_EXTERNAL_AGENT)
    );
    if !valid {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "agent.runtimeActivityCandidateInvalid",
            None,
        ));
    }
    Ok(agent::GetRuntimeActivityRequest {
        runtime_kind: runtime_kind as i32,
        runtime_id: runtime_id.to_string(),
    })
}

fn request_station_activity(
    request: &agent::GetRuntimeActivityRequest,
    token: &str,
) -> Result<agent::GetRuntimeActivityResponse, station_client::StationClientError> {
    station_client::request_proto(
        Method::POST,
        "/sub-agent/agent/runtime/activity",
        token,
        None,
        Some(request),
    )
}

fn runtime_advertisement_json(value: &agent::EffectiveRuntimeAdvertisement) -> serde_json::Value {
    let state = agent::RuntimeAdvertisementState::try_from(value.state)
        .unwrap_or(agent::RuntimeAdvertisementState::Unspecified);
    json!({
        "runtime_kind": runtime_kind_name(value.runtime_kind),
        "runtime_id": value.runtime_id,
        "state": state.as_str_name(),
        "reason_code": value.reason_code,
    })
}

fn capability_session_json(value: &agent::ClientCapabilitySession) -> serde_json::Value {
    json!({
        "session_id": value.session_id,
        "ptid": value.ptid,
        "device_id": value.device_id,
        "platform": runtime_platform_name(value.platform_kind),
        "typed_capabilities": value.typed_capabilities.iter().map(|capability| {
            json!({
                "capability_id": capability.capability_id,
                "schema_version": capability.schema_version,
                "permission": agent::CapabilityPermissionState::try_from(capability.permission)
                    .unwrap_or(agent::CapabilityPermissionState::Unspecified)
                    .as_str_name(),
                "constraints": capability.constraints.as_ref().map(|constraints| json!({
                    "max_request_bytes": constraints.max_request_bytes,
                    "max_result_bytes": constraints.max_result_bytes,
                    "allowed_resource_kinds": constraints.allowed_resource_kinds,
                })),
            })
        }).collect::<Vec<_>>(),
        "expires_at": timestamp_json(value.expires_at.as_ref()),
        "connection_id": value.connection_id,
        "lease_id": value.lease_id,
        "lease_revision": value.lease_revision,
    })
}

fn runtime_activity_json(value: &agent::RuntimeActivitySnapshot) -> serde_json::Value {
    json!({
        "snapshot_id": value.snapshot_id,
        "owner": value.owner,
        "owner_instance_id": value.owner_instance_id,
        "ptid": value.ptid,
        "runtime_kind": runtime_kind_name(value.runtime_kind),
        "runtime_id": value.runtime_id,
        "counter_epoch": value.counter_epoch,
        "counters": value.counters.as_ref().map(proto_counters_json).unwrap_or_else(|| counters_json(LocalRuntimeActivityCounters::default())),
        "observed_at": timestamp_json(value.observed_at.as_ref()),
    })
}

fn proto_counters_json(value: &agent::RuntimeActivityCounters) -> serde_json::Value {
    json!({
        "runtime_bindings_created": value.runtime_bindings_created,
        "external_sessions_created": value.external_sessions_created,
        "runtime_homes_created": value.runtime_homes_created,
        "processes_started": value.processes_started,
        "workspaces_created": value.workspaces_created,
    })
}

fn counters_json(value: LocalRuntimeActivityCounters) -> serde_json::Value {
    json!({
        "runtime_bindings_created": value.runtime_bindings_created,
        "external_sessions_created": value.external_sessions_created,
        "runtime_homes_created": value.runtime_homes_created,
        "processes_started": value.processes_started,
        "workspaces_created": value.workspaces_created,
    })
}

fn runtime_kind_name(value: i32) -> &'static str {
    agent::RuntimeKind::try_from(value)
        .unwrap_or(agent::RuntimeKind::Unspecified)
        .as_str_name()
}

fn runtime_platform_name(value: i32) -> &'static str {
    agent::ClientPlatform::try_from(value)
        .unwrap_or(agent::ClientPlatform::Unspecified)
        .as_str_name()
}

fn hash_identifier(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    hex::encode(digest)
}

fn timestamp_json(value: Option<&prost_types::Timestamp>) -> serde_json::Value {
    match value {
        Some(timestamp) => json!({
            "seconds": timestamp.seconds,
            "nanos": timestamp.nanos,
        }),
        None => serde_json::Value::Null,
    }
}

fn unix_time_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn success_payload(command: &str, status: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: status.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::desktop_executor_worker::receipt_ledger::ToolCallSideEffectCount;

    #[test]
    fn candidate_validation_rejects_unknown_runtime() {
        let result = runtime_activity_request(&AgentRuntimeActivityInput {
            runtime_kind: agent::RuntimeKind::DirectModel as i32,
            runtime_id: "unknown".to_string(),
        });
        assert!(result.is_err());
    }

    #[test]
    fn local_activity_identity_is_stable_for_process_boot() {
        assert_eq!(local_instance_id(), local_instance_id());
        assert_eq!(local_counter_epoch(), local_counter_epoch());
    }

    #[test]
    fn capability_session_snapshot_hashes_actor_and_device_identity() {
        let result = capability_session_snapshot(vec![CapabilityWorkerSnapshot {
            actor_ptid: "ptid:actor-secret".to_string(),
            device_id: "device-secret".to_string(),
            capability_session_id: "session-secret".to_string(),
            lease_id: "lease-secret".to_string(),
            lease_revision: 2,
            capability_set_hash: "capability-hash".to_string(),
            platform: agent::ClientPlatform::Desktop as i32,
            capability_ids: vec!["clipboard.read".to_string()],
            local_execution_attempt_count: 3,
            local_side_effect_count: 1,
            tool_call_side_effect_counts: vec![ToolCallSideEffectCount {
                tool_call_id: "tool-call-exact".to_string(),
                side_effect_count: 1,
            }],
            expires_at_ms: 123,
        }]);
        assert!(result.ok);
        let status = result.data.expect("snapshot data").status;
        assert!(!status.contains("ptid:actor-secret"));
        assert!(!status.contains("device-secret"));
        assert!(!status.contains("session-secret"));
        assert!(!status.contains("lease-secret"));
        assert!(status.contains("capability-hash"));
        assert!(status.contains("\"local_execution_attempt_count\":3"));
        assert!(status.contains("\"local_side_effect_count\":1"));
        assert!(status.contains("\"tool_call_id\":\"tool-call-exact\""));
        assert!(status.contains("\"side_effect_count\":1"));
    }

    #[test]
    fn browser_capability_session_snapshot_has_no_desktop_capabilities() {
        let result = capability_session_snapshot(vec![CapabilityWorkerSnapshot {
            actor_ptid: "ptid:browser-actor".to_string(),
            device_id: "browser-device".to_string(),
            capability_session_id: "browser-session".to_string(),
            lease_id: "browser-lease".to_string(),
            lease_revision: 1,
            capability_set_hash: "browser-capability-hash".to_string(),
            platform: agent::ClientPlatform::Browser as i32,
            capability_ids: Vec::new(),
            local_execution_attempt_count: 0,
            local_side_effect_count: 0,
            tool_call_side_effect_counts: Vec::new(),
            expires_at_ms: 456,
        }]);
        assert!(result.ok);
        let status = result.data.expect("browser snapshot data").status;
        assert!(status.contains("CLIENT_PLATFORM_BROWSER"));
        assert!(status.contains("\"capability_ids\":[]"));
        assert!(status.contains("\"local_execution_attempt_count\":0"));
        assert!(status.contains("\"local_side_effect_count\":0"));
        assert!(status.contains("\"tool_call_side_effect_counts\":[]"));
        assert!(!status.contains("filesystem.read"));
        assert!(!status.contains("shell.execute"));
    }

    #[test]
    fn capability_negative_control_names_include_lease_lifecycle_controls() {
        assert_eq!(
            requested_negative_control("leasePause"),
            Some(RequestedCapabilityNegativeControl::LeasePause)
        );
        assert_eq!(
            requested_negative_control("leaseExpired"),
            Some(RequestedCapabilityNegativeControl::LeaseExpired)
        );
        assert_eq!(requested_negative_control("lease_expired"), None);
    }
}
