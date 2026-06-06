use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};

use super::cli_wrapped::CliWrappedAdapter;
use super::http_llm::HttpLlmAdapter;
use super::types::{ProviderAdapter, ProviderKind};

static HTTP_LLM_ADAPTER: HttpLlmAdapter = HttpLlmAdapter;
static CLI_WRAPPED_ADAPTER: CliWrappedAdapter = CliWrappedAdapter;

pub(crate) fn adapter_for(
    kind: ProviderKind,
) -> Result<&'static dyn ProviderAdapter, AppResult<StubPayload>> {
    let adapter: &'static dyn ProviderAdapter = match kind {
        ProviderKind::HttpLlm => &HTTP_LLM_ADAPTER,
        ProviderKind::CliWrapped => &CLI_WRAPPED_ADAPTER,
        ProviderKind::Native => Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "Native provider is not available yet",
            None,
        ))?,
    };
    debug_assert_eq!(adapter.kind(), kind);
    Ok(adapter)
}
