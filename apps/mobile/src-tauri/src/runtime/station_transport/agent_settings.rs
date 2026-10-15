use reqwest::header::{ACCEPT, CONTENT_TYPE};
use reqwest::{Client, Method, RequestBuilder};
use serde::Deserialize;

use crate::error::MobileResult;
use crate::runtime::oauth::session::AuthenticatedNativeSession;

use super::{authenticated_request, fixed_url, transport_error, MAX_JSON_REQUEST_BYTES};

/// Fixed Agent domain capabilities. The client cannot supply an origin, path,
/// method, authentication header, or credential-resolution operation.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum AgentSettingsRpc {
    ProviderList,
    ProviderGet,
    ProviderCreate,
    ProviderUpdate,
    ProviderDelete,
    ProviderCheck,
    ProviderModelsDiscover,
    ModelsAvailable,
    ModelCreate,
    CredentialSet,
    CredentialStatus,
    AgentList,
    AgentGet,
    AgentUpdate,
    SkillList,
    SkillGet,
    SkillInstall,
    SkillUpdate,
    SkillDelete,
    MemoryList,
    MemoryGet,
    MemoryUpdate,
    MemoryDelete,
    MemoryImport,
    MemorySearch,
    MemoryEmbeddingStatus,
    McpList,
    McpGet,
    McpUpsert,
    McpRefresh,
    McpDelete,
}

impl AgentSettingsRpc {
    fn path(&self) -> &'static str {
        match self {
            Self::ProviderList => "/sub-agent/agent/provider/list",
            Self::ProviderGet => "/sub-agent/agent/provider/get",
            Self::ProviderCreate => "/sub-agent/agent/provider/create",
            Self::ProviderUpdate => "/sub-agent/agent/provider/update",
            Self::ProviderDelete => "/sub-agent/agent/provider/delete",
            Self::ProviderCheck => "/sub-agent/agent/provider/check",
            Self::ProviderModelsDiscover => "/sub-agent/agent/provider/models/discover",
            Self::ModelsAvailable => "/sub-agent/agent/model/available",
            Self::ModelCreate => "/sub-agent/agent/model/create",
            Self::CredentialSet => "/sub-agent/agent/credential/set",
            Self::CredentialStatus => "/sub-agent/agent/credential/status",
            Self::AgentList => "/sub-agent/agent/list",
            Self::AgentGet => "/sub-agent/agent/get",
            Self::AgentUpdate => "/sub-agent/agent/update",
            Self::SkillList => "/sub-agent/agent/skill/list",
            Self::SkillGet => "/sub-agent/agent/skill/get",
            Self::SkillInstall => "/sub-agent/agent/skill/install",
            Self::SkillUpdate => "/sub-agent/agent/skill/update",
            Self::SkillDelete => "/sub-agent/agent/skill/delete",
            Self::MemoryList => "/sub-agent/agent/memory/list",
            Self::MemoryGet => "/sub-agent/agent/memory/get",
            Self::MemoryUpdate => "/sub-agent/agent/memory/update",
            Self::MemoryDelete => "/sub-agent/agent/memory/delete",
            Self::MemoryImport => "/sub-agent/agent/memory/import",
            Self::MemorySearch => "/sub-agent/agent/memory/search",
            Self::MemoryEmbeddingStatus => "/sub-agent/agent/memory/embedding-status",
            Self::McpList => "/sub-agent/agent/mcp/server/list",
            Self::McpGet => "/sub-agent/agent/mcp/server/get",
            Self::McpUpsert => "/sub-agent/agent/mcp/server/upsert",
            Self::McpRefresh => "/sub-agent/agent/mcp/server/refresh",
            Self::McpDelete => "/sub-agent/agent/mcp/server/delete",
        }
    }
}

pub(super) fn request(
    client: &Client,
    session: &AuthenticatedNativeSession,
    rpc: AgentSettingsRpc,
    body: Vec<u8>,
) -> MobileResult<RequestBuilder> {
    // Empty protobuf messages are valid list/read requests.
    if body.len() > MAX_JSON_REQUEST_BYTES {
        return Err(transport_error(
            "agent_settings_execute",
            "body_size_invalid",
        ));
    }
    let method = if matches!(rpc, AgentSettingsRpc::SkillGet) {
        Method::GET
    } else {
        Method::POST
    };
    Ok(
        authenticated_request(client, session, method, fixed_url(session, rpc.path())?)
            .header(CONTENT_TYPE, "application/protobuf")
            .header(ACCEPT, "application/protobuf")
            .body(body),
    )
}
