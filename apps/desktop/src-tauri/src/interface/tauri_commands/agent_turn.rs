use std::sync::Arc;
use crate::contracts::{AgentExecuteTurnInput, StubPayload};
use crate::error::AppResult;
use crate::application::agent_turn as application_agent_turn;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn agent_execute_turn(input: AgentExecuteTurnInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    application_agent_turn::agent_execute_turn(input, &state)
}
