use crate::application::agent_marketplace as application_marketplace;
use crate::contracts::StubPayload;
use crate::error::AppResult;

#[tauri::command]
pub fn agent_marketplace_list(
    input: application_marketplace::AgentMarketplaceListInput,
) -> AppResult<StubPayload> {
    application_marketplace::agent_marketplace_list(input)
}

#[tauri::command]
pub fn agent_marketplace_get(
    input: application_marketplace::AgentMarketplaceIdInput,
) -> AppResult<StubPayload> {
    application_marketplace::agent_marketplace_get(input)
}
