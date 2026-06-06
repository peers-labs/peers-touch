use crate::application::provider::remote as provider_remote;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};

use super::types::{
    ProviderAdapter, ProviderCapability, ProviderKind, ProviderRequest, ProviderResponse,
};

pub(crate) struct CliWrappedAdapter;

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
        match provider_remote::chat_completion(
            &request.provider.endpoint,
            &request.provider.api_key,
            &request.provider.model_id,
            Some(request.provider.protocol),
            request.prompt,
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
