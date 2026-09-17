use prost::Message;
use reqwest::Method;
use serde::Deserialize;

use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::agent;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodedRequestInput {
    #[serde(alias = "request_bytes")]
    pub request_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvaluationOperation {
    CreateBenchmark,
    UpdateBenchmark,
    DeleteBenchmark,
    ListBenchmarks,
    CreateDataset,
    UpdateDataset,
    DeleteDataset,
    ListDatasets,
    CreateTestCase,
    UpdateTestCase,
    DeleteTestCase,
    ListTestCases,
    CreateRun,
    StartRun,
    CancelRun,
    RetryCases,
    GetRun,
    ListRuns,
    ListRunEvents,
    DeleteRun,
}

impl EvaluationOperation {
    pub const fn path(self) -> &'static str {
        match self {
            Self::CreateBenchmark => "/sub-agent/agent/evaluation/benchmark/create",
            Self::UpdateBenchmark => "/sub-agent/agent/evaluation/benchmark/update",
            Self::DeleteBenchmark => "/sub-agent/agent/evaluation/benchmark/delete",
            Self::ListBenchmarks => "/sub-agent/agent/evaluation/benchmark/list",
            Self::CreateDataset => "/sub-agent/agent/evaluation/dataset/create",
            Self::UpdateDataset => "/sub-agent/agent/evaluation/dataset/update",
            Self::DeleteDataset => "/sub-agent/agent/evaluation/dataset/delete",
            Self::ListDatasets => "/sub-agent/agent/evaluation/dataset/list",
            Self::CreateTestCase => "/sub-agent/agent/evaluation/case/create",
            Self::UpdateTestCase => "/sub-agent/agent/evaluation/case/update",
            Self::DeleteTestCase => "/sub-agent/agent/evaluation/case/delete",
            Self::ListTestCases => "/sub-agent/agent/evaluation/case/list",
            Self::CreateRun => "/sub-agent/agent/evaluation/run/create",
            Self::StartRun => "/sub-agent/agent/evaluation/run/start",
            Self::CancelRun => "/sub-agent/agent/evaluation/run/cancel",
            Self::RetryCases => "/sub-agent/agent/evaluation/run/retry",
            Self::GetRun => "/sub-agent/agent/evaluation/run/get",
            Self::ListRuns => "/sub-agent/agent/evaluation/run/list",
            Self::ListRunEvents => "/sub-agent/agent/evaluation/run/events/list",
            Self::DeleteRun => "/sub-agent/agent/evaluation/run/delete",
        }
    }

    const fn failure_key(self) -> &'static str {
        match self {
            Self::CreateBenchmark => "agent.evaluationBenchmarkCreateFailed",
            Self::UpdateBenchmark => "agent.evaluationBenchmarkUpdateFailed",
            Self::DeleteBenchmark => "agent.evaluationBenchmarkDeleteFailed",
            Self::ListBenchmarks => "agent.evaluationBenchmarkListFailed",
            Self::CreateDataset => "agent.evaluationDatasetCreateFailed",
            Self::UpdateDataset => "agent.evaluationDatasetUpdateFailed",
            Self::DeleteDataset => "agent.evaluationDatasetDeleteFailed",
            Self::ListDatasets => "agent.evaluationDatasetListFailed",
            Self::CreateTestCase => "agent.evaluationCaseCreateFailed",
            Self::UpdateTestCase => "agent.evaluationCaseUpdateFailed",
            Self::DeleteTestCase => "agent.evaluationCaseDeleteFailed",
            Self::ListTestCases => "agent.evaluationCaseListFailed",
            Self::CreateRun => "agent.evaluationRunCreateFailed",
            Self::StartRun => "agent.evaluationRunStartFailed",
            Self::CancelRun => "agent.evaluationRunCancelFailed",
            Self::RetryCases => "agent.evaluationRunRetryFailed",
            Self::GetRun => "agent.evaluationRunGetFailed",
            Self::ListRuns => "agent.evaluationRunListFailed",
            Self::ListRunEvents => "agent.evaluationRunEventsListFailed",
            Self::DeleteRun => "agent.evaluationRunDeleteFailed",
        }
    }
}

pub fn forward(
    input: EncodedRequestInput,
    token: &str,
    operation: EvaluationOperation,
) -> AppResult<Vec<u8>> {
    macro_rules! request {
        ($request:ty, $response:ty) => {
            request_encoded::<$request, $response>(input, token, operation)
        };
    }

    match operation {
        EvaluationOperation::CreateBenchmark => request!(
            agent::CreateEvaluationBenchmarkRequest,
            agent::CreateEvaluationBenchmarkResponse
        ),
        EvaluationOperation::UpdateBenchmark => request!(
            agent::UpdateEvaluationBenchmarkRequest,
            agent::UpdateEvaluationBenchmarkResponse
        ),
        EvaluationOperation::DeleteBenchmark => request!(
            agent::DeleteEvaluationBenchmarkRequest,
            agent::DeleteEvaluationBenchmarkResponse
        ),
        EvaluationOperation::ListBenchmarks => request!(
            agent::ListEvaluationBenchmarksRequest,
            agent::ListEvaluationBenchmarksResponse
        ),
        EvaluationOperation::CreateDataset => request!(
            agent::CreateEvaluationDatasetRequest,
            agent::CreateEvaluationDatasetResponse
        ),
        EvaluationOperation::UpdateDataset => request!(
            agent::UpdateEvaluationDatasetRequest,
            agent::UpdateEvaluationDatasetResponse
        ),
        EvaluationOperation::DeleteDataset => request!(
            agent::DeleteEvaluationDatasetRequest,
            agent::DeleteEvaluationDatasetResponse
        ),
        EvaluationOperation::ListDatasets => request!(
            agent::ListEvaluationDatasetsRequest,
            agent::ListEvaluationDatasetsResponse
        ),
        EvaluationOperation::CreateTestCase => request!(
            agent::CreateEvaluationTestCaseRequest,
            agent::CreateEvaluationTestCaseResponse
        ),
        EvaluationOperation::UpdateTestCase => request!(
            agent::UpdateEvaluationTestCaseRequest,
            agent::UpdateEvaluationTestCaseResponse
        ),
        EvaluationOperation::DeleteTestCase => request!(
            agent::DeleteEvaluationTestCaseRequest,
            agent::DeleteEvaluationTestCaseResponse
        ),
        EvaluationOperation::ListTestCases => request!(
            agent::ListEvaluationTestCasesRequest,
            agent::ListEvaluationTestCasesResponse
        ),
        EvaluationOperation::CreateRun => request!(
            agent::CreateEvaluationRunRequest,
            agent::CreateEvaluationRunResponse
        ),
        EvaluationOperation::StartRun => request!(
            agent::StartEvaluationRunRequest,
            agent::StartEvaluationRunResponse
        ),
        EvaluationOperation::CancelRun => request!(
            agent::CancelEvaluationRunRequest,
            agent::CancelEvaluationRunResponse
        ),
        EvaluationOperation::RetryCases => request!(
            agent::RetryEvaluationCasesRequest,
            agent::RetryEvaluationCasesResponse
        ),
        EvaluationOperation::GetRun => request!(
            agent::GetEvaluationRunRequest,
            agent::GetEvaluationRunResponse
        ),
        EvaluationOperation::ListRuns => request!(
            agent::ListEvaluationRunsRequest,
            agent::ListEvaluationRunsResponse
        ),
        EvaluationOperation::ListRunEvents => request!(
            agent::ListEvaluationRunEventsRequest,
            agent::ListEvaluationRunEventsResponse
        ),
        EvaluationOperation::DeleteRun => request!(
            agent::DeleteEvaluationRunRequest,
            agent::DeleteEvaluationRunResponse
        ),
    }
}

fn request_encoded<Req, Resp>(
    input: EncodedRequestInput,
    token: &str,
    operation: EvaluationOperation,
) -> AppResult<Vec<u8>>
where
    Req: Message + Default,
    Resp: Message + Default,
{
    let request = match Req::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.evaluationRequestInvalid",
                None,
            )
        }
    };
    match station_client::request_proto::<Req, Resp>(
        Method::POST,
        operation.path(),
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result(operation.failure_key()),
    }
}

#[cfg(test)]
mod tests {
    use prost::Message;

    use crate::error::ErrorCode;
    use crate::model::agent;

    use super::{request_encoded, EncodedRequestInput, EvaluationOperation};

    #[test]
    fn evaluation_routes_follow_the_station_resource_owner() {
        assert_eq!(
            EvaluationOperation::ListBenchmarks.path(),
            "/sub-agent/agent/evaluation/benchmark/list"
        );
        assert_eq!(
            EvaluationOperation::ListRunEvents.path(),
            "/sub-agent/agent/evaluation/run/events/list"
        );
        assert_eq!(
            EvaluationOperation::RetryCases.path(),
            "/sub-agent/agent/evaluation/run/retry"
        );
    }

    #[test]
    fn create_run_request_decodes_only_authoring_fields() {
        let request = agent::CreateEvaluationRunRequest {
            dataset_id: "dataset-1".to_string(),
            dataset_revision: 7,
            readiness_snapshot_id: "readiness-1".to_string(),
            idempotency_key: "run-create-1".to_string(),
            target_agent_id: "agent-1".to_string(),
            expected_agent_revision: 9,
            runtime_profile_id: Some("runtime-1".to_string()),
            model_id: Some("model-1".to_string()),
        };
        let decoded = agent::CreateEvaluationRunRequest::decode(request.encode_to_vec().as_slice())
            .expect("generated create-run request should decode");

        assert_eq!(decoded.target_agent_id, "agent-1");
        assert_eq!(decoded.expected_agent_revision, 9);
        assert_eq!(decoded.readiness_snapshot_id, "readiness-1");
        assert_eq!(decoded.runtime_profile_id.as_deref(), Some("runtime-1"));
        assert_eq!(decoded.model_id.as_deref(), Some("model-1"));
    }

    #[test]
    fn malformed_evaluation_request_is_rejected_before_transport() {
        let result =
            request_encoded::<agent::GetEvaluationRunRequest, agent::GetEvaluationRunResponse>(
                EncodedRequestInput {
                    request_bytes: vec![0xff],
                },
                "token",
                EvaluationOperation::GetRun,
            );

        assert!(!result.ok);
        assert_eq!(
            result.error.expect("typed error").code,
            ErrorCode::InvalidArgument
        );
    }
}
