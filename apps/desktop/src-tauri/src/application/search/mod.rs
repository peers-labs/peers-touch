use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{AiSearchInput, SearchQueryInput, StubPayload};
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

pub fn help_get() -> AppResult<StubPayload> {
    success_payload("help_get", json!({ "categories": [] }))
}

pub fn search_sources() -> AppResult<StubPayload> {
    success_payload("search_sources", json!({ "sources": [] }))
}

pub fn search_query(input: SearchQueryInput) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return invalid_argument("query is required");
    }
    success_payload(
        "search_query",
        json!({
            "query":input.query,
            "source":input.source.unwrap_or_else(|| "all".to_string()),
            "results":[],
            "count":0
        }),
    )
}

pub fn search_ai(input: AiSearchInput) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return invalid_argument("query is required");
    }
    let web = input.web.unwrap_or(false);
    success_payload(
        "search_ai",
        json!({
            "answer":"",
            "query":input.query,
            "web":web,
            "sources":[]
        }),
    )
}
