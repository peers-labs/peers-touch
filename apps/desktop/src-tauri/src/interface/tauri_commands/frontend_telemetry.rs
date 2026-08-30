use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client::{self, StationClientError};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{State, Window};

const MAX_BATCH_EVENTS: usize = 500;

#[derive(Debug, Deserialize)]
pub struct FrontendTelemetryUploadInput {
    pub events: Vec<Value>,
}

#[tauri::command]
pub fn frontend_telemetry_upload(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: FrontendTelemetryUploadInput,
) -> AppResult<StubPayload> {
    if input.events.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "events must not be empty", None);
    }
    if input.events.len() > MAX_BATCH_EVENTS {
        return AppResult::fail(ErrorCode::InvalidArgument, "events batch exceeds 500", None);
    }
    let token = match crate::application::session_resolver::token_for_window(state.inner(), &window)
    {
        Some(token) => token,
        None => return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None),
    };
    match post_frontend_telemetry_batch_with_auth(token.as_str(), json!({ "events": input.events }))
    {
        Ok(data) => AppResult::success(StubPayload {
            command: "frontend_telemetry_upload".to_string(),
            status: data.to_string(),
        }),
        Err(error) => error.into_app_result("frontend telemetry upload failed"),
    }
}

fn post_frontend_telemetry_batch_with_auth(
    token: &str,
    body: Value,
) -> Result<Value, StationClientError> {
    station_client::post_json_with_auth("/telemetry/frontend/events/batch", token, body)
}
