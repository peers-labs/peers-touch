use crate::application::session_resolver;
use crate::contracts::{
    SkillImportAddressInput, SkillImportGitHubInput, SkillImportZipInput, SkillMarketAddInput,
    SkillMarketDetailInput, SkillMarketIdInput, SkillMarketListInput, SkillMarketSyncInput,
    StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{State, Window};

use crate::application::skills_market as application_skills_market;

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
pub fn skills_import_url(
    input: SkillImportAddressInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills_market::skills_import_url(input, &token)
}

#[tauri::command]
pub fn skills_import_github(
    input: SkillImportGitHubInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills_market::skills_import_github(input, &token)
}

#[tauri::command]
pub fn skills_import_zip(
    input: SkillImportZipInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    application_skills_market::skills_import_zip(input, &token)
}

#[tauri::command]
pub fn skills_validate_zip(input: SkillImportZipInput) -> AppResult<StubPayload> {
    application_skills_market::skills_validate_zip(input)
}

#[tauri::command]
pub fn skills_market_dir() -> AppResult<StubPayload> {
    application_skills_market::skills_market_dir()
}

#[tauri::command]
pub fn skills_market_open_dir() -> AppResult<StubPayload> {
    application_skills_market::skills_market_open_dir()
}

#[tauri::command]
pub fn skills_market_list() -> AppResult<StubPayload> {
    application_skills_market::skills_market_list()
}

#[tauri::command]
pub fn skills_market_add(input: SkillMarketAddInput) -> AppResult<StubPayload> {
    application_skills_market::skills_market_add(input)
}

#[tauri::command]
pub fn skills_market_remove(input: SkillMarketIdInput) -> AppResult<StubPayload> {
    application_skills_market::skills_market_remove(input)
}

#[tauri::command]
pub fn skills_market_sync(input: SkillMarketSyncInput) -> AppResult<StubPayload> {
    application_skills_market::skills_market_sync(input)
}

#[tauri::command]
pub fn skills_market_list_skills(input: SkillMarketListInput) -> AppResult<StubPayload> {
    application_skills_market::skills_market_list_skills(input)
}

#[tauri::command]
pub fn skills_market_detail(input: SkillMarketDetailInput) -> AppResult<StubPayload> {
    application_skills_market::skills_market_detail(input)
}

#[tauri::command]
pub fn skills_market_install(
    input: SkillMarketDetailInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    let actor_ptid = session_resolver::ptid_for_window(state.inner(), &window).unwrap_or_default();
    application_skills_market::skills_market_install(&actor_ptid, input, &token)
}

#[tauri::command]
pub fn skills_market_uninstall(
    input: SkillMarketDetailInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    let actor_ptid = session_resolver::ptid_for_window(state.inner(), &window).unwrap_or_default();
    application_skills_market::skills_market_uninstall(&actor_ptid, input, &token)
}
