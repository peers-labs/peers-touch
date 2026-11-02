// TW-D3 logical artifact transport: typed proto passthrough to the
// Station `/agent/task/artifact/*` routes. No local business truth.
use crate::application::station_runtime::client::StationClient;
use crate::error::AppResult;
use crate::model::agent::v1 as agent;
use prost::Message;
use reqwest::Method;

fn post<Req, Resp>(
    client: &StationClient,
    path: &str,
    token: &str,
    request: &Req,
) -> AppResult<Vec<u8>>
where
    Req: Message,
    Resp: Message + Default,
{
    match client.request_proto::<Req, Resp>(Method::POST, path, token, None, Some(request)) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.taskArtifactRequestFailed"),
    }
}

pub fn claim_version(
    client: &StationClient,
    token: &str,
    request: &agent::ClaimArtifactVersionRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::ClaimArtifactVersionResponse>(
        client,
        "/sub-agent/agent/task/artifact/claim-version",
        token,
        request,
    )
}

pub fn list_task_artifacts(
    client: &StationClient,
    token: &str,
    request: &agent::ListTaskArtifactsRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::ListTaskArtifactsResponse>(
        client,
        "/sub-agent/agent/task/artifact/list",
        token,
        request,
    )
}

pub fn list_versions(
    client: &StationClient,
    token: &str,
    request: &agent::ListArtifactVersionsRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::ListArtifactVersionsResponse>(
        client,
        "/sub-agent/agent/task/artifact/versions",
        token,
        request,
    )
}

pub fn get_body(
    client: &StationClient,
    token: &str,
    request: &agent::GetArtifactVersionBodyRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::GetArtifactVersionBodyResponse>(
        client,
        "/sub-agent/agent/task/artifact/body/get",
        token,
        request,
    )
}

pub fn submit_feedback(
    client: &StationClient,
    token: &str,
    request: &agent::SubmitArtifactFeedbackRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::SubmitArtifactFeedbackResponse>(
        client,
        "/sub-agent/agent/task/artifact/feedback/submit",
        token,
        request,
    )
}

pub fn list_feedback(
    client: &StationClient,
    token: &str,
    request: &agent::ListArtifactFeedbackRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::ListArtifactFeedbackResponse>(
        client,
        "/sub-agent/agent/task/artifact/feedback/list",
        token,
        request,
    )
}

pub fn record_check(
    client: &StationClient,
    token: &str,
    request: &agent::RecordArtifactCheckRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::RecordArtifactCheckResponse>(
        client,
        "/sub-agent/agent/task/artifact/check/record",
        token,
        request,
    )
}

pub fn list_checks(
    client: &StationClient,
    token: &str,
    request: &agent::ListArtifactChecksRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::ListArtifactChecksResponse>(
        client,
        "/sub-agent/agent/task/artifact/check/list",
        token,
        request,
    )
}

pub fn accept_version(
    client: &StationClient,
    token: &str,
    request: &agent::AcceptArtifactVersionRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::AcceptArtifactVersionResponse>(
        client,
        "/sub-agent/agent/task/artifact/accept",
        token,
        request,
    )
}

pub fn list_acceptances(
    client: &StationClient,
    token: &str,
    request: &agent::ListArtifactAcceptancesRequest,
) -> AppResult<Vec<u8>> {
    post::<_, agent::ListArtifactAcceptancesResponse>(
        client,
        "/sub-agent/agent/task/artifact/acceptance/list",
        token,
        request,
    )
}
