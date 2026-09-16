use prost::Message;
use reqwest::Method;
use serde::Deserialize;

use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::agent;

const HOME_PROJECTION_PATH: &str = "/sub-agent/agent/home/projection/get";

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
