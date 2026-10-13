use prost::Message;
use reqwest::Method;
use serde::Deserialize;

use crate::application::station_runtime::client::StationClient;
use crate::error::{AppResult, ErrorCode};
use crate::model::agent;

const HOME_PROJECTION_PATH: &str = "/sub-agent/agent/home/projection/get";
const HOME_CHAT_SUBMIT_PATH: &str = "/sub-agent/agent/home/chat/submit";
const HOME_TASK_SUBMIT_PATH: &str = "/sub-agent/agent/home/task/submit";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodedRequestInput {
    #[serde(alias = "request_bytes")]
    pub request_bytes: Vec<u8>,
}

pub fn get_projection(
    station_client: &StationClient,
    input: EncodedRequestInput,
    token: &str,
) -> AppResult<Vec<u8>> {
    let request = match agent::GetHomeWorkProjectionRequest::decode(input.request_bytes.as_slice())
    {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.homeProjectionRequestInvalid",
                None,
            )
        }
    };

    match station_client.request_proto::<_, agent::GetHomeWorkProjectionResponse>(
        Method::POST,
        HOME_PROJECTION_PATH,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.homeProjectionLoadFailed"),
    }
}

pub fn submit_chat(
    station_client: &StationClient,
    input: EncodedRequestInput,
    token: &str,
) -> AppResult<Vec<u8>> {
    let request = match agent::SubmitHomeChatCommandRequest::decode(input.request_bytes.as_slice())
    {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.homeChatRequestInvalid",
                None,
            )
        }
    };

    match station_client.request_proto::<_, agent::SubmitHomeChatCommandResponse>(
        Method::POST,
        HOME_CHAT_SUBMIT_PATH,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.homeChatSubmitFailed"),
    }
}

pub fn submit_task(
    station_client: &StationClient,
    input: EncodedRequestInput,
    token: &str,
) -> AppResult<Vec<u8>> {
    let request = match agent::SubmitHomeTaskCommandRequest::decode(input.request_bytes.as_slice())
    {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.homeTaskRequestInvalid",
                None,
            )
        }
    };

    match station_client.request_proto::<_, agent::SubmitHomeTaskCommandResponse>(
        Method::POST,
        HOME_TASK_SUBMIT_PATH,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.homeTaskSubmitFailed"),
    }
}
