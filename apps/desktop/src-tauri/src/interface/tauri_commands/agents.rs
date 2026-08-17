use std::sync::Arc;

use crate::application::agent_workspace::{self, WorkspaceCleanScope};
use crate::contracts::{
    AgentCreateInput, AgentDuplicateInput, AgentIdInput, AgentPackageExportInput,
    AgentPackageImportInput, AgentSearchInput, AgentSelectInput, AgentUpdateInput,
    AgentWorkspaceCleanInput, AgentWorkspaceInfoInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};

use crate::application::agents as application_agents;
use crate::application::session_resolver;
use crate::state::AppState;
use tauri::{State, Window};

fn actor_id_for_cmd(state: &State<'_, Arc<AppState>>, window: &Window) -> String {
    session_resolver::actor_id_for_window(state.inner(), window).unwrap_or_default()
}

fn token_for_cmd(state: &State<'_, Arc<AppState>>, window: &Window) -> String {
    session_resolver::token_for_window(state.inner(), window).unwrap_or_default()
}

#[tauri::command]
pub fn agents_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    let token = token_for_cmd(&state, &window);
    application_agents::agents_list(&actor_id, &token)
}

#[tauri::command]
pub fn agents_get_selected(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_get_selected(&actor_id)
}

#[tauri::command]
pub fn agents_set_selected(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentSelectInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_set_selected(&actor_id, input)
}

#[tauri::command]
pub fn agents_get_default(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_get_default(&actor_id)
}

#[tauri::command]
pub fn agents_set_default(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentIdInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    application_agents::agents_set_default(&actor_id, input)
}

#[tauri::command]
pub fn agents_get(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentIdInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    let token = token_for_cmd(&state, &window);
    application_agents::agents_get(&actor_id, &token, input)
}

#[tauri::command]
pub fn agents_create(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentCreateInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    let token = token_for_cmd(&state, &window);
    application_agents::agents_create(&actor_id, &token, input)
}

#[tauri::command]
pub fn agents_update(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentUpdateInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    let token = token_for_cmd(&state, &window);
    application_agents::agents_update(&actor_id, &token, input)
}

#[tauri::command]
pub fn agents_delete(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentIdInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    let token = token_for_cmd(&state, &window);
    application_agents::agents_delete(&actor_id, &token, input)
}

#[tauri::command]
pub fn agents_duplicate(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentDuplicateInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    let token = token_for_cmd(&state, &window);
    application_agents::agents_duplicate(&actor_id, &token, input)
}

#[tauri::command]
pub fn agents_export_package(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentPackageExportInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    let token = token_for_cmd(&state, &window);
    application_agents::agents_export_package(&actor_id, &token, input)
}

#[tauri::command]
pub fn agents_import_package(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AgentPackageImportInput,
) -> AppResult<StubPayload> {
    let actor_id = actor_id_for_cmd(&state, &window);
    let token = token_for_cmd(&state, &window);
    application_agents::agents_import_package(&actor_id, &token, input)
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

#[tauri::command]
pub fn agent_workspace_info(input: AgentWorkspaceInfoInput) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.trim();
    if agent_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "agent_id is required", None);
    }
    match agent_workspace::workspace_info(agent_id) {
        Ok(info) => match serde_json::to_string(&info) {
            Ok(status) => AppResult::success(StubPayload {
                command: "agent_workspace_info".to_string(),
                status,
            }),
            Err(error) => AppResult::fail(ErrorCode::InternalError, error.to_string(), None),
        },
        Err(error) => AppResult::fail(ErrorCode::InternalError, error, None),
    }
}

#[tauri::command]
pub fn agent_workspace_clean(input: AgentWorkspaceCleanInput) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.trim();
    if agent_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "agent_id is required", None);
    }
    let scope = match WorkspaceCleanScope::from_str(input.scope.trim()) {
        Ok(scope) => scope,
        Err(error) => {
            return AppResult::fail(ErrorCode::InvalidArgument, error, None);
        }
    };

    let result = if scope == WorkspaceCleanScope::Tasks {
        if let Some(retention_days) = input.retention_days {
            agent_workspace::clean_expired_tasks(agent_id, retention_days)
        } else {
            agent_workspace::clean_workspace(agent_id, scope)
        }
    } else {
        agent_workspace::clean_workspace(agent_id, scope)
    };

    match result {
        Ok(freed_bytes) => AppResult::success(StubPayload {
            command: "agent_workspace_clean".to_string(),
            status: serde_json::json!({ "freed_bytes": freed_bytes }).to_string(),
        }),
        Err(error) => AppResult::fail(ErrorCode::InternalError, error, None),
    }
}
