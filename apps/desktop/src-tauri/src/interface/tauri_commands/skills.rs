use crate::application::session_resolver;
use crate::contracts::{
    BuiltinSkillIdInput, SkillCreateInput, SkillIdInput, SkillRollbackInput, SkillToggleInput,
    SkillUpdateInput, SkillVersionsInput, SkillsListInput, SkillsSearchInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{State, Window};

use crate::application::skills as application_skills;

fn token_or_unauthorized(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<StubPayload>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

#[tauri::command]
pub fn skills_list(
    input: SkillsListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills::skills_list(input, &token)
}

#[tauri::command]
pub fn skills_search(
    input: SkillsSearchInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills::skills_search(input, &token)
}

#[tauri::command]
pub fn skills_get(
    input: SkillIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills::skills_get(input, &token)
}

#[tauri::command]
pub fn skills_get_builtin(input: BuiltinSkillIdInput) -> AppResult<StubPayload> {
    application_skills::skills_get_builtin(input)
}

#[tauri::command]
pub fn skills_create(
    input: SkillCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills::skills_create(input, &token)
}

#[tauri::command]
pub fn skills_update(
    input: SkillUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills::skills_update(input, &token)
}

#[tauri::command]
pub fn skills_delete(
    input: SkillIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills::skills_delete(input, &token)
}

#[tauri::command]
pub fn skills_toggle(
    input: SkillToggleInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills::skills_toggle(input, &token)
}

#[tauri::command]
pub fn skills_versions(
    input: SkillVersionsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills::skills_versions(input, &token)
}

#[tauri::command]
pub fn skills_rollback(
    input: SkillRollbackInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills::skills_rollback(input, &token)
}
