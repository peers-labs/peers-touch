use crate::contracts::{SearchPrimaryInput, StubPayload};
use crate::error::AppResult;

use crate::application::tools as application_tools;

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
