use crate::application::a2a as application_a2a;
use crate::contracts::StubPayload;
use crate::error::AppResult;

#[tauri::command]
pub fn agent_a2a_list(input: application_a2a::A2AListInput) -> AppResult<StubPayload> {
    application_a2a::agent_a2a_list(input)
}

#[tauri::command]
pub fn agent_a2a_start(input: application_a2a::A2AStartInput) -> AppResult<StubPayload> {
    application_a2a::agent_a2a_start(input)
}

#[tauri::command]
pub fn agent_a2a_update_task(input: application_a2a::A2AUpdateTaskInput) -> AppResult<StubPayload> {
    application_a2a::agent_a2a_update_task(input)
}
