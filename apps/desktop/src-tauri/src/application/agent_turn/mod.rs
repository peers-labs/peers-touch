use crate::contracts::{AgentExecuteTurnInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::state::AppState;
use reqwest::Method;
use serde_json::json;

pub fn agent_execute_turn(input: AgentExecuteTurnInput, state: &AppState) -> AppResult<StubPayload> {
    tracing::info!(
        command = "agent_execute_turn",
        agent_id = %input.agent_id,
        conversation_id = %input.conversation_id,
        "Executing agent turn via Station"
    );

    let token = match token_from_state(state) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let body = json!({
        "conversation_id": input.conversation_id,
        "agent_id": input.agent_id,
        "user_input": input.user_input,
        "provider": input.provider.unwrap_or_default(),
        "model": input.model.unwrap_or_default(),
        "identity": input.identity.unwrap_or_default(),
        "platform": input.platform.unwrap_or("desktop".to_string()),
        "workspace_root": input.workspace_root.unwrap_or_default(),
        "context_window_size": input.context_window_size.unwrap_or(128000),
        "max_retries": input.max_retries.unwrap_or(3),
    });

    match station_client::request_json(
        Method::POST,
        "/agent/turn/execute",
        &token,
        None,
        Some(body),
    ) {
        Ok(result) => {
            tracing::info!(command = "agent_execute_turn", "Turn execution succeeded");
            let status = serde_json::to_string(&result)
                .unwrap_or_else(|_| r#"{"status":"ok"}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_execute_turn".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_execute_turn", error = %err, "Turn execution failed");
            AppResult::fail(
                ErrorCode::InternalError,
                "error.agent.turnFailed",
                Some(json!({ "detail": err })),
            )
        }
    }
}

fn token_from_state(state: &AppState) -> Result<String, AppResult<StubPayload>> {
    let guard = state.session.lock().map_err(|_| {
        AppResult::fail(ErrorCode::InternalError, "error.auth.sessionLockFailed", None)
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "error.auth.authenticationRequired",
            None,
        ));
    }
    Ok(token)
}
