use crate::contracts::StubPayload;
use crate::error::AppResult;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProviderKind {
    HttpLlm,
    CliWrapped,
    #[allow(dead_code)]
    Native,
}

impl ProviderKind {
    pub(crate) fn as_trace_label(self) -> &'static str {
        match self {
            ProviderKind::HttpLlm => "http_llm",
            ProviderKind::CliWrapped => "cli_wrapped",
            ProviderKind::Native => "native",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ProviderCapability {
    pub(crate) stream: bool,
    pub(crate) cancel: bool,
    pub(crate) tool_call: bool,
    pub(crate) black_box: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ProviderControl {
    pub(crate) timeout_ms: Option<u64>,
    pub(crate) cwd: Option<String>,
    pub(crate) env: Vec<(String, String)>,
}

#[derive(Clone, Debug)]
pub(crate) struct ResolvedProvider {
    pub(crate) provider_id: String,
    pub(crate) kind: ProviderKind,
    pub(crate) endpoint: String,
    pub(crate) api_key: String,
    pub(crate) model_id: String,
    pub(crate) protocol: &'static str,
    pub(crate) capability: ProviderCapability,
    pub(crate) control: ProviderControl,
}

pub(crate) struct ProviderRequest<'a> {
    pub(crate) provider: &'a ResolvedProvider,
    pub(crate) prompt: &'a str,
}

#[derive(Debug)]
pub(crate) struct ProviderResponse {
    pub(crate) text: String,
    pub(crate) model: String,
}

pub(crate) trait ProviderAdapter: Sync {
    fn kind(&self) -> ProviderKind;

    fn capability(&self) -> ProviderCapability;

    fn complete(
        &self,
        request: ProviderRequest<'_>,
    ) -> Result<ProviderResponse, AppResult<StubPayload>>;
}
