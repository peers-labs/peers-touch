use crate::error::AppResult;
use crate::interface::contracts::{
    BuiltinSkillIdInput, SkillCreateInput, SkillIdInput, SkillsListInput, SkillsSearchInput, SkillToggleInput,
    SkillUpdateInput, StubPayload,
};

#[path = "../../application/skills/mod.rs"]
mod application_skills;

#[tauri::command]
pub fn skills_list(input: SkillsListInput) -> AppResult<StubPayload> {
    application_skills::skills_list(input)
}

#[tauri::command]
pub fn skills_search(input: SkillsSearchInput) -> AppResult<StubPayload> {
    application_skills::skills_search(input)
}

#[tauri::command]
pub fn skills_get(input: SkillIdInput) -> AppResult<StubPayload> {
    application_skills::skills_get(input)
}

#[tauri::command]
pub fn skills_get_builtin(input: BuiltinSkillIdInput) -> AppResult<StubPayload> {
    application_skills::skills_get_builtin(input)
}

#[tauri::command]
pub fn skills_create(input: SkillCreateInput) -> AppResult<StubPayload> {
    application_skills::skills_create(input)
}

#[tauri::command]
pub fn skills_update(input: SkillUpdateInput) -> AppResult<StubPayload> {
    application_skills::skills_update(input)
}

#[tauri::command]
pub fn skills_delete(input: SkillIdInput) -> AppResult<StubPayload> {
    application_skills::skills_delete(input)
}

#[tauri::command]
pub fn skills_toggle(input: SkillToggleInput) -> AppResult<StubPayload> {
    application_skills::skills_toggle(input)
}
