// `ExecuteTurnRequest` / `ExecuteTurnResponse` exist in `model::agent`, but Station's
// `HandleExecuteTurn` binds JSON to ad-hoc Go structs (not generated protos) and the JSON
// payload includes fields not present on the proto (identity, platform, workspace_root, …).
// `TypedHandler` protobuf mode requires `proto.Message` request types. Keep JSON until the
// subserver handler and proto definitions are aligned with the desktop contract.
// TODO(agent): align `agent.proto` + Station `HandleExecuteTurn` with the full turn payload, then use `request_proto`.
use crate::contracts::{AgentExecuteTurnInput, StubPayload};
use crate::error::AppResult;
use crate::infrastructure::station_client;
use reqwest::Method;
use serde_json::json;

pub fn agent_execute_turn(input: AgentExecuteTurnInput, token: &str) -> AppResult<StubPayload> {
    tracing::info!(
        command = "agent_execute_turn",
        agent_id = %input.agent_id,
        conversation_id = %input.conversation_id,
        "Executing agent turn via Station"
    );

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
        token,
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
            err.into_app_result("Failed to execute agent turn")
        }
    }
}
