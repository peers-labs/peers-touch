use prost::Message;
use reqwest::Method;
use serde::Deserialize;

use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::agent;

const HOME_PROJECTION_PATH: &str = "/sub-agent/agent/home/projection/get";
const HOME_CHAT_SUBMIT_PATH: &str = "/sub-agent/agent/home/chat/submit";
const HOME_TASK_SUBMIT_PATH: &str = "/sub-agent/agent/home/task/submit";
const GOAL_CREATE_PATH: &str = "/sub-agent/agent/goal/create";
const GOAL_GET_PATH: &str = "/sub-agent/agent/goal/get";
const GOAL_UPDATE_PATH: &str = "/sub-agent/agent/goal/update";
const GOAL_REVIEW_PATH: &str = "/sub-agent/agent/goal/review";
const GOAL_ADMIT_PATH: &str = "/sub-agent/agent/goal/admit";
const GOAL_START_PATH: &str = "/sub-agent/agent/goal/start";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodedRequestInput {
    #[serde(alias = "request_bytes")]
    pub request_bytes: Vec<u8>,
}

pub fn get_projection(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
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

    match station_client::request_proto::<_, agent::GetHomeWorkProjectionResponse>(
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

pub fn submit_chat(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
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

    match station_client::request_proto::<_, agent::SubmitHomeChatCommandResponse>(
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

pub fn submit_task(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
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

    match station_client::request_proto::<_, agent::SubmitHomeTaskCommandResponse>(
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

pub fn create_goal(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    let request = match agent::CreateAgentGoalRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.goalCreateRequestInvalid",
                None,
            )
        }
    };

    match station_client::request_proto::<_, agent::CreateAgentGoalResponse>(
        Method::POST,
        GOAL_CREATE_PATH,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.goalCreateFailed"),
    }
}

pub fn get_goal(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    let request = match agent::GetAgentGoalRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.goalGetRequestInvalid",
                None,
            )
        }
    };

    match station_client::request_proto::<_, agent::GetAgentGoalResponse>(
        Method::POST,
        GOAL_GET_PATH,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.goalGetFailed"),
    }
}

pub fn update_goal(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    let request = match agent::UpdateAgentGoalRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.goalUpdateRequestInvalid",
                None,
            )
        }
    };

    match station_client::request_proto::<_, agent::UpdateAgentGoalResponse>(
        Method::POST,
        GOAL_UPDATE_PATH,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.goalUpdateFailed"),
    }
}

pub fn review_goal(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    let request = match agent::ReviewAgentGoalRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.goalReviewRequestInvalid",
                None,
            )
        }
    };

    match station_client::request_proto::<_, agent::ReviewAgentGoalResponse>(
        Method::POST,
        GOAL_REVIEW_PATH,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.goalReviewFailed"),
    }
}

pub fn admit_goal(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    let request = match agent::AdmitAgentGoalRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.goalAdmitRequestInvalid",
                None,
            )
        }
    };

    match station_client::request_proto::<_, agent::AdmitAgentGoalResponse>(
        Method::POST,
        GOAL_ADMIT_PATH,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.goalAdmitFailed"),
    }
}

pub fn start_goal(input: EncodedRequestInput, token: &str) -> AppResult<Vec<u8>> {
    let request = match agent::StartAgentGoalRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.goalStartRequestInvalid",
                None,
            )
        }
    };

    match station_client::request_proto::<_, agent::StartAgentGoalResponse>(
        Method::POST,
        GOAL_START_PATH,
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => error.into_app_result("agent.goalStartFailed"),
    }
}
