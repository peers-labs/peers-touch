use crate::error::AppResult;
use crate::interface::contracts::{
    SkillImportAddressInput, SkillImportGitHubInput, SkillMarketAddInput, SkillMarketDetailInput, SkillMarketIdInput,
    SkillMarketListInput, SkillMarketSyncInput, StubPayload,
};

#[path = "../../application/skills_market/mod.rs"]
mod application_skills_market;

#[tauri::command]
pub fn skills_import_url(input: SkillImportAddressInput) -> AppResult<StubPayload> {
    application_skills_market::skills_import_url(input)
}

#[tauri::command]
pub fn skills_import_github(input: SkillImportGitHubInput) -> AppResult<StubPayload> {
    application_skills_market::skills_import_github(input)
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
pub fn skills_market_install(input: SkillMarketDetailInput) -> AppResult<StubPayload> {
    application_skills_market::skills_market_install(input)
}
