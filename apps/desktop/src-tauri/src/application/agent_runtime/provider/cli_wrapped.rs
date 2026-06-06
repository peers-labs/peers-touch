use crate::application::provider::cli_runtime::{self, CliExecutionControl};
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};

use super::types::{
    ProviderAdapter, ProviderCapability, ProviderKind, ProviderRequest, ProviderResponse,
};

pub(crate) struct CliWrappedAdapter;

fn execution_control(request: &ProviderRequest<'_>) -> CliExecutionControl {
    CliExecutionControl {
        timeout_ms: request.provider.control.timeout_ms,
        cwd: request.provider.control.cwd.clone(),
        env: request.provider.control.env.clone(),
    }
}

impl ProviderAdapter for CliWrappedAdapter {
    fn kind(&self) -> ProviderKind {
        ProviderKind::CliWrapped
    }

    fn capability(&self) -> ProviderCapability {
        ProviderCapability {
            stream: false,
            cancel: false,
            tool_call: false,
            black_box: true,
        }
    }

    fn complete(
        &self,
        request: ProviderRequest<'_>,
    ) -> Result<ProviderResponse, AppResult<StubPayload>> {
        match cli_runtime::complete(
            &request.provider.endpoint,
            &request.provider.model_id,
            request.prompt,
            &execution_control(&request),
        ) {
            Ok(result) => Ok(ProviderResponse {
                text: result.text,
                model: result.model,
            }),
            Err(err) => {
                tracing::error!(command = "agent_execute_turn", error = %err, "CLI-wrapped provider execution failed");
                Err(AppResult::fail(
                    ErrorCode::InternalError,
                    format!("Agent provider execution failed: {}", err),
                    None,
                ))
            }
        }
    }
}
