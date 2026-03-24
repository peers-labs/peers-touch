use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{SearchPrimaryInput, StubPayload};
use serde_json::json;

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

pub fn tools_list() -> AppResult<StubPayload> {
    success_payload(
        "tools_list",
        json!({
            "tools":[
                {"name":"web_search","enabled":true},
                {"name":"file_search","enabled":true}
            ]
        }),
    )
}

pub fn tools_search_providers() -> AppResult<StubPayload> {
    success_payload(
        "tools_search_providers",
        json!({
            "providers":[
                {"id":"all","name":"All"},
                {"id":"web","name":"Web"}
            ],
            "primary":"all"
        }),
    )
}

pub fn tools_set_search_primary(input: SearchPrimaryInput) -> AppResult<StubPayload> {
    if input.provider.trim().is_empty() {
        return invalid_argument("provider is required");
    }
    success_payload(
        "tools_set_search_primary",
        json!({
            "ok":true,
            "primary":input.provider
        }),
    )
}
