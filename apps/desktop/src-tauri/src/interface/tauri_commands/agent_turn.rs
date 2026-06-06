use crate::application::agent_turn as application_agent_turn;
use crate::application::session_resolver;
use crate::contracts::{AgentExecuteTurnInput, StubPayload};
use crate::error::AppResult;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;
use tauri::Window;

#[tauri::command]
pub fn agent_execute_turn(
    input: AgentExecuteTurnInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_agent_turn::agent_execute_turn(&actor_id, input)
}

#[tauri::command]
pub fn agent_turn_traces() -> AppResult<StubPayload> {
    application_agent_turn::agent_turn_traces()
}
