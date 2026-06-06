use std::sync::Arc;

use crate::contracts::{
    AgentCreateInput, AgentDuplicateInput, AgentIdInput, AgentSearchInput, AgentUpdateInput,
    AgentsReorderInput, StubPayload,
};
use crate::error::AppResult;

use crate::application::agents as application_agents;
use crate::application::session_resolver;
use crate::state::AppState;
use tauri::{State, Window};

fn actor_id_for_cmd(state: &State<'_, Arc<AppState>>, window: &Window) -> String {
    session_resolver::actor_id_for_window(state.inner(), window).unwrap_or_default()
}

#[tauri::command]
pub fn agents_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_list(&actor_id)
}

#[tauri::command]
pub fn agents_get(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentIdInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_get(&actor_id, input)
}

#[tauri::command]
pub fn agents_create(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentCreateInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_create(&actor_id, input)
}

#[tauri::command]
pub fn agents_update(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentUpdateInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_update(&actor_id, input)
}

#[tauri::command]
pub fn agents_delete(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentIdInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_delete(&actor_id, input)
}

#[tauri::command]
pub fn agents_duplicate(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentDuplicateInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_duplicate(&actor_id, input)
}

#[tauri::command]
pub fn agents_reorder(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentsReorderInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_reorder(&actor_id, input)
}

#[tauri::command]
pub fn agents_search(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentSearchInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_search(&actor_id, input)
}

#[tauri::command]
pub fn agents_list_sessions(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentIdInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_list_sessions(&actor_id, input)
}
