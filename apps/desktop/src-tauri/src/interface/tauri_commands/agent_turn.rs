use std::sync::Arc;
use crate::contracts::{AgentExecuteTurnInput, StubPayload};
use crate::error::AppResult;
use crate::error::ErrorCode;
use crate::application::agent_turn as application_agent_turn;
use crate::application::session_resolver;
use crate::state::AppState;
use tauri::State;
use tauri::Window;

#[tauri::command]
pub fn agent_execute_turn(
    input: AgentExecuteTurnInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_execute_turn(input, &token)
}
