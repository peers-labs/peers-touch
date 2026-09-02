use crate::error::{AppError, ErrorCode};
use crate::state::AppState;
use std::sync::Arc;

pub(crate) mod fenced_executor;
pub(crate) mod local_executor;
pub(crate) mod operation_executor;
pub(crate) mod operation_ledger;
pub(crate) mod operation_worker;
pub(crate) mod receipt_ledger;
pub(crate) mod recovery_signer;
pub(crate) mod resource_registry;
pub(crate) mod station_transport;
pub(crate) mod supervisor;

pub use supervisor::CapabilityWorkerSupervisor;

const CANVAS_READINESS_LOCALE_KEY: &str = "agent.errors.canvasSingleAgentNotReady";
const CANVAS_READINESS_REQUIRED_GATE: &str = "agent-v2-kernel-foundation-e2e";

fn enforce_canvas_single_agent_readiness() -> Result<(), AppError> {
    Err(AppError {
        code: ErrorCode::AgentCanvasSingleAgentNotReady,
        message: CANVAS_READINESS_LOCALE_KEY.to_string(),
        details: Some(serde_json::json!({
            "required_gate": CANVAS_READINESS_REQUIRED_GATE,
        })),
    })
}

pub fn start(_state: Arc<AppState>) {
    if let Err(blocker) = enforce_canvas_single_agent_readiness() {
        tracing::info!(
            code = ?blocker.code,
            required_gate = CANVAS_READINESS_REQUIRED_GATE,
            "desktop executor worker blocked by single-Agent readiness"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{enforce_canvas_single_agent_readiness, CANVAS_READINESS_REQUIRED_GATE};
    use crate::error::ErrorCode;
    use serde_json::Value;

    #[test]
    fn desktop_executor_worker_fails_before_starting_any_runtime_effect() {
        let blocker =
            enforce_canvas_single_agent_readiness().expect_err("guard must remain closed");
        assert_eq!(blocker.code, ErrorCode::AgentCanvasSingleAgentNotReady);
        assert_eq!(
            blocker
                .details
                .as_ref()
                .and_then(|details| details.get("required_gate"))
                .and_then(Value::as_str),
            Some(CANVAS_READINESS_REQUIRED_GATE),
        );
    }
}
