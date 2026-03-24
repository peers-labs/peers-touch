use crate::error::AppResult;
use crate::interface::contracts::{
    AgentCreateInput, AgentDuplicateInput, AgentIdInput, AgentSearchInput, AgentUpdateInput, StubPayload,
};

#[path = "../../application/agents/mod.rs"]
mod application_agents;

#[tauri::command]
pub fn agents_list() -> AppResult<StubPayload> {
    application_agents::agents_list()
}

#[tauri::command]
pub fn agents_get(input: AgentIdInput) -> AppResult<StubPayload> {
    application_agents::agents_get(input)
}

#[tauri::command]
pub fn agents_create(input: AgentCreateInput) -> AppResult<StubPayload> {
    application_agents::agents_create(input)
}

#[tauri::command]
pub fn agents_update(input: AgentUpdateInput) -> AppResult<StubPayload> {
    application_agents::agents_update(input)
}

#[tauri::command]
pub fn agents_delete(input: AgentIdInput) -> AppResult<StubPayload> {
    application_agents::agents_delete(input)
}

#[tauri::command]
pub fn agents_duplicate(input: AgentDuplicateInput) -> AppResult<StubPayload> {
    application_agents::agents_duplicate(input)
}

#[tauri::command]
pub fn agents_search(input: AgentSearchInput) -> AppResult<StubPayload> {
    application_agents::agents_search(input)
}

#[tauri::command]
pub fn agents_list_sessions(input: AgentIdInput) -> AppResult<StubPayload> {
    application_agents::agents_list_sessions(input)
}
