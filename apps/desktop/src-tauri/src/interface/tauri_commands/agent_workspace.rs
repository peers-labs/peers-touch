//! Agent working-directory selection commands.
//!
//! One capability session has one active working directory (private sandbox
//! by default, or a user-authorized local project / worktree). These thin
//! commands are shared by the production Tauri surface and the headless HTTP
//! gateway used by acceptance closures; all authorization and persistence
//! lives in [`CapabilityWorkerSupervisor`].
use crate::application::desktop_executor_worker::CapabilityWorkerSupervisor;
use crate::application::session_resolver;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, Window};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirectoryInput {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWorktreeInput {
    pub base: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLocatorInput {
    #[serde(default)]
    pub locator: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChoicePayload {
    pub locator: String,
    pub label: String,
    pub is_git: bool,
    pub worktree_base: Option<String>,
    pub created_at_ms: i64,
    pub last_used_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatePayload {
    /// Canonical root granted to the live session; None = private sandbox.
    pub current_root: Option<String>,
    pub choices: Vec<WorkspaceChoicePayload>,
}

fn authenticated_actor(
    state: &Arc<AppState>,
    window: &Window,
) -> Result<String, AppResult<WorkspaceStatePayload>> {
    let token = session_resolver::token_for_window(state, window).unwrap_or_default();
    let actor_ptid = session_resolver::ptid_for_window(state, window).unwrap_or_default();
    if token.trim().is_empty() || !actor_ptid.starts_with("ptid:") {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(actor_ptid)
}

fn workspace_failed<T: Serialize>(error: String) -> AppResult<T> {
    AppResult::fail(
        ErrorCode::Conflict,
        "agent.workspaceOperationFailed",
        Some(serde_json::json!({ "cause": error })),
    )
}

pub(crate) fn workspace_state_payload(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
) -> Result<WorkspaceStatePayload, String> {
    let device_id = supervisor.device_id_for_actor(actor_ptid)?;
    let current_root = supervisor
        .active_workspace(actor_ptid, &device_id)?
        .map(|root| root.to_string_lossy().to_string());
    let choices = supervisor
        .list_workspace_choices(actor_ptid)?
        .into_iter()
        .map(|choice| WorkspaceChoicePayload {
            locator: choice.locator,
            label: choice.label,
            is_git: choice.is_git,
            worktree_base: choice.worktree_base,
            created_at_ms: choice.created_at_ms,
            last_used_ms: choice.last_used_ms,
        })
        .collect();
    Ok(WorkspaceStatePayload {
        current_root,
        choices,
    })
}

pub(crate) fn list_workspaces(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
) -> AppResult<WorkspaceStatePayload> {
    match workspace_state_payload(supervisor, actor_ptid) {
        Ok(payload) => AppResult::success(payload),
        Err(error) => workspace_failed(error),
    }
}

pub(crate) fn add_workspace_directory(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
    path: &str,
) -> AppResult<WorkspaceStatePayload> {
    if let Err(error) = supervisor.add_workspace_choice(actor_ptid, path) {
        return workspace_failed(error);
    }
    list_workspaces(supervisor, actor_ptid)
}

pub(crate) fn create_workspace_worktree(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
    base: &str,
    name: &str,
) -> AppResult<WorkspaceStatePayload> {
    if let Err(error) = supervisor.create_workspace_choice(actor_ptid, base, name) {
        return workspace_failed(error);
    }
    list_workspaces(supervisor, actor_ptid)
}

pub(crate) fn remove_workspace(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
    locator: &str,
) -> AppResult<WorkspaceStatePayload> {
    if let Err(error) = supervisor.remove_workspace_choice(actor_ptid, locator) {
        return workspace_failed(error);
    }
    list_workspaces(supervisor, actor_ptid)
}

pub(crate) fn activate_workspace(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
    locator: Option<String>,
) -> AppResult<WorkspaceStatePayload> {
    if let Err(error) = supervisor.activate_workspace_choice(actor_ptid, locator.as_deref()) {
        return workspace_failed(error);
    }
    list_workspaces(supervisor, actor_ptid)
}

#[tauri::command]
pub fn agent_workspace_list(
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<WorkspaceStatePayload> {
    let actor_ptid = match authenticated_actor(state.inner(), &window) {
        Ok(actor_ptid) => actor_ptid,
        Err(error) => return error,
    };
    list_workspaces(supervisor.inner(), &actor_ptid)
}

#[tauri::command]
pub fn agent_workspace_add_directory(
    input: WorkspaceDirectoryInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<WorkspaceStatePayload> {
    let actor_ptid = match authenticated_actor(state.inner(), &window) {
        Ok(actor_ptid) => actor_ptid,
        Err(error) => return error,
    };
    add_workspace_directory(supervisor.inner(), &actor_ptid, input.path.trim())
}

#[tauri::command]
pub async fn agent_workspace_create_worktree(
    input: WorkspaceWorktreeInput,
    app: AppHandle,
    window: Window,
) -> AppResult<WorkspaceStatePayload> {
    let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
    let actor_ptid = {
        let token = session_resolver::token_for_window(&state, &window).unwrap_or_default();
        let actor = session_resolver::ptid_for_window(&state, &window).unwrap_or_default();
        if token.trim().is_empty() || !actor.starts_with("ptid:") {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "authentication required",
                None,
            );
        }
        actor
    };
    let supervisor: Arc<CapabilityWorkerSupervisor> = app
        .state::<Arc<CapabilityWorkerSupervisor>>()
        .inner()
        .clone();
    match tauri::async_runtime::spawn_blocking(move || {
        create_workspace_worktree(&supervisor, &actor_ptid, input.base.trim(), input.name.trim())
    })
    .await
    {
        Ok(result) => result,
        Err(error) => workspace_failed(format!("worktree task join failed: {error}")),
    }
}

#[tauri::command]
pub fn agent_workspace_remove(
    input: WorkspaceLocatorInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<WorkspaceStatePayload> {
    let actor_ptid = match authenticated_actor(state.inner(), &window) {
        Ok(actor_ptid) => actor_ptid,
        Err(error) => return error,
    };
    let locator = input.locator.unwrap_or_default();
    remove_workspace(supervisor.inner(), &actor_ptid, locator.trim())
}

#[tauri::command]
pub async fn agent_workspace_activate(
    input: WorkspaceLocatorInput,
    app: AppHandle,
    window: Window,
) -> AppResult<WorkspaceStatePayload> {
    let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
    let actor_ptid = {
        let token = session_resolver::token_for_window(&state, &window).unwrap_or_default();
        let actor = session_resolver::ptid_for_window(&state, &window).unwrap_or_default();
        if token.trim().is_empty() || !actor.starts_with("ptid:") {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "authentication required",
                None,
            );
        }
        actor
    };
    let supervisor: Arc<CapabilityWorkerSupervisor> = app
        .state::<Arc<CapabilityWorkerSupervisor>>()
        .inner()
        .clone();
    match tauri::async_runtime::spawn_blocking(move || {
        activate_workspace(&supervisor, &actor_ptid, input.locator)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => workspace_failed(format!("workspace activation task join failed: {error}")),
    }
}
