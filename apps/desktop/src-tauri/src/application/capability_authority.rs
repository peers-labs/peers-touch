use prost::Message;
use reqwest::Method;
use serde::Deserialize;

use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::agent;

const MANIFEST_LIST_PATH: &str = "/sub-agent/agent/capability/manifest/list";
const BINDING_LIST_PATH: &str = "/sub-agent/agent/capability/binding/list";
const BINDING_UPSERT_PATH: &str = "/sub-agent/agent/capability/binding/upsert";
const BINDING_DELETE_PATH: &str = "/sub-agent/agent/capability/binding/delete";
const READINESS_PATH: &str = "/sub-agent/agent/capability/readiness";
#[cfg(feature = "acceptance-webdriver")]
const ACCEPTANCE_SCENARIO_PREPARE_PATH: &str =
    "/sub-agent/agent/capability/acceptance/scenario/prepare";
#[cfg(feature = "acceptance-webdriver")]
const ACCEPTANCE_SCENARIO_ARM_PATH: &str = "/sub-agent/agent/capability/acceptance/scenario/arm";
#[cfg(feature = "acceptance-webdriver")]
const ACCEPTANCE_SCENARIO_WAIT_PATH: &str = "/sub-agent/agent/capability/acceptance/scenario/wait";
const ACCEPTANCE_SCENARIO_RELEASE_PATH: &str =
    "/sub-agent/agent/capability/acceptance/scenario/release";
#[cfg(feature = "acceptance-webdriver")]
const ACCEPTANCE_SCENARIO_CLOCK_ADVANCE_PATH: &str =
    "/sub-agent/agent/capability/acceptance/scenario/clock/advance";
#[cfg(feature = "acceptance-webdriver")]
const ACCEPTANCE_SCENARIO_INTERRUPT_PATH: &str =
    "/sub-agent/agent/capability/acceptance/scenario/interrupt";
#[cfg(feature = "acceptance-webdriver")]
const ACCEPTANCE_SCENARIO_CLEANUP_PATH: &str =
    "/sub-agent/agent/capability/acceptance/scenario/cleanup";
const CONNECTOR_MANIFEST_SYNC_PATH: &str = "/sub-agent/agent/connector/manifest/sync";
const CONNECTOR_MANIFEST_LIST_PATH: &str = "/sub-agent/agent/connector/manifest/list";
const OPERATION_CANCEL_PATH: &str = "/sub-agent/agent/capability/operation/cancel";
const OPERATION_GET_PATH: &str = "/sub-agent/agent/capability/operation/get";
const OPERATION_RECONCILE_PATH: &str = "/sub-agent/agent/capability/operation/reconcile";
const KNOWLEDGE_DESCRIPTOR_CREATE_PATH: &str = "/sub-agent/agent/knowledge/descriptor/create";
const KNOWLEDGE_DESCRIPTOR_UPDATE_PATH: &str = "/sub-agent/agent/knowledge/descriptor/update";
const KNOWLEDGE_DESCRIPTOR_LIST_PATH: &str = "/sub-agent/agent/knowledge/descriptor/list";
const KNOWLEDGE_DESCRIPTOR_TOMBSTONE_PATH: &str = "/sub-agent/agent/knowledge/descriptor/tombstone";
const AGENT_PACKAGE_EXPORT_PATH: &str = "/sub-agent/agent/package/export";
const AGENT_PACKAGE_IMPORT_PATH: &str = "/sub-agent/agent/package/import";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityManifestListInput {
    #[serde(default, alias = "source_kinds")]
    pub source_kinds: Vec<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityBindingListInput {
    #[serde(alias = "agent_id")]
    pub agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityBindingUpsertInput {
    pub binding: CapabilityBindingInput,
    #[serde(alias = "idempotency_key")]
    pub idempotency_key: String,
    #[serde(default, alias = "expected_binding_revision")]
    pub expected_binding_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityBindingInput {
    #[serde(default, alias = "binding_id")]
    pub binding_id: String,
    #[serde(alias = "agent_id")]
    pub agent_id: String,
    #[serde(alias = "capability_id")]
    pub capability_id: String,
    #[serde(alias = "capability_version")]
    pub capability_version: String,
    pub enabled: bool,
    #[serde(alias = "approval_policy")]
    pub approval_policy: i32,
    #[serde(alias = "expected_agent_version")]
    pub expected_agent_version: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityBindingDeleteInput {
    #[serde(alias = "binding_id")]
    pub binding_id: String,
    #[serde(alias = "expected_binding_revision")]
    pub expected_binding_revision: u64,
    #[serde(alias = "idempotency_key")]
    pub idempotency_key: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReadinessInput {
    #[serde(alias = "agent_id")]
    pub agent_id: String,
    #[serde(default, alias = "runtime_snapshot_id")]
    pub runtime_snapshot_id: Option<String>,
    #[serde(default, alias = "client_capability_session_id")]
    pub client_capability_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodedRequestInput {
    #[serde(alias = "request_bytes")]
    pub request_bytes: Vec<u8>,
}

pub fn list_manifests(input: CapabilityManifestListInput, token: &str) -> AppResult<Vec<u8>> {
    request::<_, agent::ListCapabilityManifestsResponse>(
        MANIFEST_LIST_PATH,
        &agent::ListCapabilityManifestsRequest {
            source_kinds: input.source_kinds,
        },
        token,
        "agent.capabilityManifestListFailed",
    )
}

pub fn list_bindings(input: CapabilityBindingListInput, token: &str) -> AppResult<Vec<u8>> {
    match list_binding_records(&input.agent_id, token) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.capabilityBindingListFailed"),
    }
}

pub fn upsert_binding(input: CapabilityBindingUpsertInput, token: &str) -> AppResult<Vec<u8>> {
    let binding = input.binding;
    match upsert_binding_record(
        agent::AgentCapabilityBinding {
            binding_id: binding.binding_id.trim().to_string(),
            ptid: String::new(),
            agent_id: binding.agent_id.trim().to_string(),
            capability_id: binding.capability_id.trim().to_string(),
            capability_version: binding.capability_version.trim().to_string(),
            enabled: binding.enabled,
            approval_policy: binding.approval_policy,
            expected_agent_version: binding.expected_agent_version,
            ..Default::default()
        },
        input.idempotency_key.trim(),
        input.expected_binding_revision,
        token,
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.capabilityBindingUpsertFailed"),
    }
}

pub fn delete_binding(input: CapabilityBindingDeleteInput, token: &str) -> AppResult<Vec<u8>> {
    request::<_, agent::DeleteAgentCapabilityBindingResponse>(
        BINDING_DELETE_PATH,
        &agent::DeleteAgentCapabilityBindingRequest {
            binding_id: input.binding_id.trim().to_string(),
            expected_binding_revision: input.expected_binding_revision,
            idempotency_key: input.idempotency_key.trim().to_string(),
            reason: input.reason.trim().to_string(),
        },
        token,
        "agent.capabilityBindingDeleteFailed",
    )
}

pub fn readiness(input: CapabilityReadinessInput, token: &str) -> AppResult<Vec<u8>> {
    request::<_, agent::GetCapabilityReadinessResponse>(
        READINESS_PATH,
        &agent::GetCapabilityReadinessRequest {
            agent_id: input.agent_id.trim().to_string(),
            runtime_snapshot_id: input.runtime_snapshot_id.unwrap_or_default(),
            client_capability_session_id: input.client_capability_session_id,
        },
        token,
        "agent.capabilityReadinessFailed",
    )
}

#[cfg(feature = "acceptance-webdriver")]
pub fn prepare_acceptance_scenario(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::PrepareCapabilityAcceptanceScenarioRequest,
        agent::PrepareCapabilityAcceptanceScenarioResponse,
    >(
        ACCEPTANCE_SCENARIO_PREPARE_PATH,
        input,
        token,
        "agent.capabilityAcceptanceScenarioPrepareFailed",
        "agent.capabilityAcceptanceScenarioRequestInvalid",
    )
}

#[cfg(feature = "acceptance-webdriver")]
pub fn arm_acceptance_scenario_hook(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::ArmCapabilityAcceptanceExecutorHookRequest,
        agent::ArmCapabilityAcceptanceExecutorHookResponse,
    >(
        ACCEPTANCE_SCENARIO_ARM_PATH,
        input,
        token,
        "agent.capabilityAcceptanceScenarioArmFailed",
        "agent.capabilityAcceptanceScenarioRequestInvalid",
    )
}

#[cfg(feature = "acceptance-webdriver")]
pub fn wait_acceptance_scenario_barrier(
    input: EncodedRequestInput,
    token: &str,
) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::WaitCapabilityAcceptanceBarrierRequest,
        agent::WaitCapabilityAcceptanceBarrierResponse,
    >(
        ACCEPTANCE_SCENARIO_WAIT_PATH,
        input,
        token,
        "agent.capabilityAcceptanceScenarioWaitFailed",
        "agent.capabilityAcceptanceScenarioRequestInvalid",
    )
}

#[cfg(feature = "acceptance-webdriver")]
pub fn release_acceptance_scenario_barrier(
    input: EncodedRequestInput,
    token: &str,
) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::ReleaseCapabilityAcceptanceBarrierRequest,
        agent::ReleaseCapabilityAcceptanceBarrierResponse,
    >(
        ACCEPTANCE_SCENARIO_RELEASE_PATH,
        input,
        token,
        "agent.capabilityAcceptanceScenarioReleaseFailed",
        "agent.capabilityAcceptanceScenarioRequestInvalid",
    )
}

#[cfg(feature = "acceptance-webdriver")]
pub fn advance_acceptance_scenario_clock(
    input: EncodedRequestInput,
    token: &str,
) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::AdvanceCapabilityAcceptanceScenarioClockRequest,
        agent::AdvanceCapabilityAcceptanceScenarioClockResponse,
    >(
        ACCEPTANCE_SCENARIO_CLOCK_ADVANCE_PATH,
        input,
        token,
        "agent.capabilityAcceptanceScenarioClockAdvanceFailed",
        "agent.capabilityAcceptanceScenarioRequestInvalid",
    )
}

#[cfg(feature = "acceptance-webdriver")]
pub fn interrupt_acceptance_scenario_worker(
    input: EncodedRequestInput,
    token: &str,
) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::InterruptCapabilityAcceptanceWorkerRequest,
        agent::InterruptCapabilityAcceptanceWorkerResponse,
    >(
        ACCEPTANCE_SCENARIO_INTERRUPT_PATH,
        input,
        token,
        "agent.capabilityAcceptanceScenarioInterruptFailed",
        "agent.capabilityAcceptanceScenarioRequestInvalid",
    )
}

#[cfg(feature = "acceptance-webdriver")]
pub fn cleanup_acceptance_scenario(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::CleanupCapabilityAcceptanceScenarioRequest,
        agent::CleanupCapabilityAcceptanceScenarioResponse,
    >(
        ACCEPTANCE_SCENARIO_CLEANUP_PATH,
        input,
        token,
        "agent.capabilityAcceptanceScenarioCleanupFailed",
        "agent.capabilityAcceptanceScenarioRequestInvalid",
    )
}

pub fn list_connector_manifests(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::ListConnectorResourceManifestsRequest,
        agent::ListConnectorResourceManifestsResponse,
    >(
        CONNECTOR_MANIFEST_LIST_PATH,
        input,
        token,
        "agent.connectorManifestListFailed",
        "agent.connectorManifestRequestInvalid",
    )
}

pub(crate) fn sync_connector_manifest_records(
    request: &agent::SyncConnectorResourceManifestsRequest,
    token: &str,
) -> Result<agent::SyncConnectorResourceManifestsResponse, station_client::StationClientError> {
    station_client::request_proto(
        Method::POST,
        CONNECTOR_MANIFEST_SYNC_PATH,
        token,
        None,
        Some(request),
    )
}

pub(crate) fn list_connector_manifest_records(
    connector_id: &str,
    token: &str,
) -> Result<Vec<agent::ConnectorResourceManifest>, station_client::StationClientError> {
    station_client::request_proto::<
        agent::ListConnectorResourceManifestsRequest,
        agent::ListConnectorResourceManifestsResponse,
    >(
        Method::POST,
        CONNECTOR_MANIFEST_LIST_PATH,
        token,
        None,
        Some(&agent::ListConnectorResourceManifestsRequest {
            connector_id: connector_id.trim().to_string(),
        }),
    )
    .map(|response| response.manifests)
}

pub fn cancel_operation(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::CancelCapabilityOperationRequest,
        agent::CancelCapabilityOperationResponse,
    >(
        OPERATION_CANCEL_PATH,
        input,
        token,
        "agent.capabilityOperationCancelFailed",
        "agent.capabilityOperationRequestInvalid",
    )
}

pub fn get_operation(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<agent::GetCapabilityOperationRequest, agent::GetCapabilityOperationResponse>(
        OPERATION_GET_PATH,
        input,
        token,
        "agent.capabilityOperationGetFailed",
        "agent.capabilityOperationRequestInvalid",
    )
}

pub fn reconcile_operation(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::ReconcileCapabilityOperationRequest,
        agent::ReconcileCapabilityOperationResponse,
    >(
        OPERATION_RECONCILE_PATH,
        input,
        token,
        "agent.capabilityOperationReconcileFailed",
        "agent.capabilityOperationRequestInvalid",
    )
}

pub fn create_knowledge_descriptor(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::CreateKnowledgeResourceDescriptorRequest,
        agent::CreateKnowledgeResourceDescriptorResponse,
    >(
        KNOWLEDGE_DESCRIPTOR_CREATE_PATH,
        input,
        token,
        "agent.knowledgeDescriptorCreateFailed",
        "agent.knowledgeDescriptorRequestInvalid",
    )
}

pub fn update_knowledge_descriptor(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::UpdateKnowledgeResourceDescriptorRequest,
        agent::UpdateKnowledgeResourceDescriptorResponse,
    >(
        KNOWLEDGE_DESCRIPTOR_UPDATE_PATH,
        input,
        token,
        "agent.knowledgeDescriptorUpdateFailed",
        "agent.knowledgeDescriptorRequestInvalid",
    )
}

pub fn list_knowledge_descriptors(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::ListKnowledgeResourceDescriptorsRequest,
        agent::ListKnowledgeResourceDescriptorsResponse,
    >(
        KNOWLEDGE_DESCRIPTOR_LIST_PATH,
        input,
        token,
        "agent.knowledgeDescriptorListFailed",
        "agent.knowledgeDescriptorRequestInvalid",
    )
}

pub fn tombstone_knowledge_descriptor(
    input: EncodedRequestInput,
    token: &str,
) -> AppResult<Vec<u8>> {
    request_encoded::<
        agent::TombstoneKnowledgeResourceDescriptorRequest,
        agent::TombstoneKnowledgeResourceDescriptorResponse,
    >(
        KNOWLEDGE_DESCRIPTOR_TOMBSTONE_PATH,
        input,
        token,
        "agent.knowledgeDescriptorTombstoneFailed",
        "agent.knowledgeDescriptorRequestInvalid",
    )
}

pub fn export_agent_package(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<agent::ExportAgentPackageRequest, agent::ExportAgentPackageResponse>(
        AGENT_PACKAGE_EXPORT_PATH,
        input,
        token,
        "agent.packageExportFailed",
        "agent.packageExportRequestInvalid",
    )
}

pub fn import_agent_package(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    request_encoded::<agent::ImportAgentPackageRequest, agent::ImportAgentPackageResponse>(
        AGENT_PACKAGE_IMPORT_PATH,
        input,
        token,
        "agent.packageImportFailed",
        "agent.packageImportRequestInvalid",
    )
}

pub(crate) fn list_binding_records(
    agent_id: &str,
    token: &str,
) -> Result<agent::ListAgentCapabilityBindingsResponse, station_client::StationClientError> {
    station_client::request_proto(
        Method::POST,
        BINDING_LIST_PATH,
        token,
        None,
        Some(&agent::ListAgentCapabilityBindingsRequest {
            agent_id: agent_id.trim().to_string(),
        }),
    )
}

pub(crate) fn upsert_binding_record(
    binding: agent::AgentCapabilityBinding,
    idempotency_key: &str,
    expected_binding_revision: u64,
    token: &str,
) -> Result<agent::UpsertAgentCapabilityBindingResponse, station_client::StationClientError> {
    station_client::request_proto(
        Method::POST,
        BINDING_UPSERT_PATH,
        token,
        None,
        Some(&agent::UpsertAgentCapabilityBindingRequest {
            binding: Some(binding),
            idempotency_key: idempotency_key.trim().to_string(),
            expected_binding_revision,
        }),
    )
}

fn request<Req, Resp>(
    path: &str,
    body: &Req,
    token: &str,
    error_context: &str,
) -> AppResult<Vec<u8>>
where
    Req: Message,
    Resp: Message + Default,
{
    match station_client::request_proto::<Req, Resp>(Method::POST, path, token, None, Some(body)) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result(error_context),
    }
}

fn request_encoded<Req, Resp>(
    path: &str,
    input: EncodedRequestInput,
    token: &str,
    error_context: &str,
    invalid_request_error: &str,
) -> AppResult<Vec<u8>>
where
    Req: Message + Default,
    Resp: Message + Default,
{
    let decoded = match decode_request::<Req>(&input, invalid_request_error) {
        Ok(request) => request,
        Err(error) => return error,
    };
    request::<Req, Resp>(path, &decoded, token, error_context)
}

fn decode_request<Req>(
    input: &EncodedRequestInput,
    invalid_request_error: &str,
) -> Result<Req, AppResult<Vec<u8>>>
where
    Req: Message + Default,
{
    Req::decode(input.request_bytes.as_slice())
        .map_err(|_| AppResult::fail(ErrorCode::InvalidArgument, invalid_request_error, None))
}

#[cfg(test)]
mod tests {
    use prost::Message;

    use crate::error::ErrorCode;
    use crate::model::agent;

    use super::{
        decode_request, CapabilityBindingUpsertInput, CapabilityManifestListInput,
        EncodedRequestInput,
    };

    #[test]
    fn capability_inputs_accept_camel_case() {
        let input: CapabilityBindingUpsertInput = serde_json::from_value(serde_json::json!({
            "binding": {
                "bindingId": "binding-1",
                "agentId": "agent-1",
                "capabilityId": "filesystem.read",
                "capabilityVersion": "1",
                "enabled": true,
                "approvalPolicy": 1,
                "expectedAgentVersion": 3
            },
            "idempotencyKey": "command-1",
            "expectedBindingRevision": 2
        }))
        .expect("camelCase input should deserialize");

        assert_eq!(input.binding.capability_id, "filesystem.read");
        assert_eq!(input.expected_binding_revision, 2);
    }

    #[test]
    fn capability_inputs_accept_snake_case() {
        let input: CapabilityManifestListInput = serde_json::from_value(serde_json::json!({
            "source_kinds": [1, 2]
        }))
        .expect("snake_case input should deserialize");

        assert_eq!(input.source_kinds, vec![1, 2]);
    }

    #[test]
    fn knowledge_descriptor_input_decodes_generated_request() {
        let request = agent::ListKnowledgeResourceDescriptorsRequest {
            include_tombstoned: true,
            cursor: "cursor-1".to_string(),
            page_size: 100,
        };
        let input = EncodedRequestInput {
            request_bytes: request.encode_to_vec(),
        };

        let decoded = decode_request::<agent::ListKnowledgeResourceDescriptorsRequest>(
            &input,
            "agent.knowledgeDescriptorRequestInvalid",
        )
        .expect("generated request should decode");

        assert!(decoded.include_tombstoned);
        assert_eq!(decoded.cursor, "cursor-1");
        assert_eq!(decoded.page_size, 100);
    }

    #[test]
    fn knowledge_descriptor_input_rejects_malformed_protobuf() {
        let error = decode_request::<agent::CreateKnowledgeResourceDescriptorRequest>(
            &EncodedRequestInput {
                request_bytes: vec![0xff],
            },
            "agent.knowledgeDescriptorRequestInvalid",
        )
        .expect_err("malformed request must fail");

        assert_eq!(
            error.error.expect("error details").code,
            ErrorCode::InvalidArgument
        );
    }

    #[test]
    fn agent_package_inputs_decode_generated_requests() {
        let export_request = agent::ExportAgentPackageRequest {
            agent_id: "agent-1".to_string(),
        };
        let decoded_export = decode_request::<agent::ExportAgentPackageRequest>(
            &EncodedRequestInput {
                request_bytes: export_request.encode_to_vec(),
            },
            "agent.packageExportRequestInvalid",
        )
        .expect("generated export request should decode");
        assert_eq!(decoded_export.agent_id, "agent-1");

        let import_request = agent::ImportAgentPackageRequest {
            package: Some(agent::AgentPackageDocument {
                schema_version: "peers.agent.package.v1".to_string(),
                ..Default::default()
            }),
            name: "Imported Agent".to_string(),
            idempotency_key: "package-import-1".to_string(),
        };
        let decoded_import = decode_request::<agent::ImportAgentPackageRequest>(
            &EncodedRequestInput {
                request_bytes: import_request.encode_to_vec(),
            },
            "agent.packageImportRequestInvalid",
        )
        .expect("generated import request should decode");
        assert_eq!(decoded_import.name, "Imported Agent");
        assert_eq!(
            decoded_import.package.expect("package").schema_version,
            "peers.agent.package.v1"
        );
    }
}
