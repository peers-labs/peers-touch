use crate::error::AppResult;
use crate::interface::contracts::{SearchPrimaryInput, StubPayload};

#[path = "../../application/tools/mod.rs"]
mod application_tools;

#[tauri::command]
pub fn tools_list() -> AppResult<StubPayload> {
    application_tools::tools_list()
}

#[tauri::command]
pub fn tools_search_providers() -> AppResult<StubPayload> {
    application_tools::tools_search_providers()
}

#[tauri::command]
pub fn tools_set_search_primary(input: SearchPrimaryInput) -> AppResult<StubPayload> {
    application_tools::tools_set_search_primary(input)
}
