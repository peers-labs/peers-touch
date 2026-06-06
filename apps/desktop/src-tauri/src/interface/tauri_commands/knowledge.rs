use crate::application::knowledge as application_knowledge;
use crate::contracts::StubPayload;
use crate::error::AppResult;

#[tauri::command]
pub fn agent_knowledge_list(
    input: application_knowledge::KnowledgeListInput,
) -> AppResult<StubPayload> {
    application_knowledge::agent_knowledge_list(input)
}

#[tauri::command]
pub fn agent_knowledge_bind(
    input: application_knowledge::KnowledgeBindInput,
) -> AppResult<StubPayload> {
    application_knowledge::agent_knowledge_bind(input)
}

#[tauri::command]
pub fn agent_knowledge_update(
    input: application_knowledge::KnowledgeUpdateInput,
) -> AppResult<StubPayload> {
    application_knowledge::agent_knowledge_update(input)
}

#[tauri::command]
pub fn agent_knowledge_delete(
    input: application_knowledge::KnowledgeDeleteInput,
) -> AppResult<StubPayload> {
    application_knowledge::agent_knowledge_delete(input)
}
